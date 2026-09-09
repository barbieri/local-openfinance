import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type ConfigValidationError,
  DEFAULT_ANNOTATION,
  DEFAULT_INTELLIGENCE,
  DEFAULT_REPORT,
  DEFAULT_REPORT_AGENT_BUDGET,
  DEFAULT_SMTP,
  DEFAULT_SYNC,
  loadConfig,
} from '../src/config/load-config.js';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('loadConfig', () => {
  it('loads and validates the expenses example', async () => {
    const resolved = await loadConfig('examples/expenses-config.json');

    expect(resolved.topicId).toBe('expenses');
    expect(resolved.config.storage.databasePath).toContain('tmp/openfinance.sqlite');
    expect(resolved.configHash).toHaveLength(64);
    expect(resolved.config.model.model).toBe('gpt-5.6-luna');
    expect(resolved.config.report.includeUnannotated).toBe(true);
    expect(resolved.config.intelligence.minReportedItemAmountCents).toBe(10_000);
    expect(resolved.config.intelligence.suggestionConfidenceThreshold).toBe(0.82);
    expect(resolved.config.chatModel).toBeUndefined();
    expect(resolved.config.reports).toMatchObject([
      {
        id: 'weekly',
        language: 'pt-BR',
        send: 'always',
      },
      {
        id: 'monthly',
        send: 'always',
        schedule: { kind: 'monthly', day: 8 },
        window: { kind: 'last-complete-month' },
      },
    ]);
    expect(resolved.config.reports.map((report) => report.id)).toEqual(['weekly', 'monthly']);
    expect(resolved.config.reports[0]?.prompts[1]).toContain('examples/expenses/weekly.md');
  });

  it('loads and validates the minimal example', async () => {
    const resolved = await loadConfig('examples/expenses-minimal-config.json');

    expect(resolved.topicId).toBe('expenses-minimal');
    expect(resolved.config.model.model).toBe('gpt-5.6-luna');
    expect(resolved.config.storage.databasePath).toContain('tmp/openfinance.sqlite');
  });

  it('resolves the full and minimal expense examples to the same behavior', async () => {
    const full = await loadConfig('examples/expenses-config.json');
    const minimal = await loadConfig('examples/expenses-minimal-config.json');
    const fullRaw = JSON.parse(await readFile('examples/expenses-config.json', 'utf8')) as Record<
      string,
      unknown
    >;
    const minimalRaw = JSON.parse(
      await readFile('examples/expenses-minimal-config.json', 'utf8'),
    ) as Record<string, unknown>;

    expect(minimal.config).toEqual(full.config);

    for (const { path: fieldPath, value } of defaultedExampleFields) {
      expect(readPath(fullRaw, fieldPath)).toEqual(value);
      expect(hasOwnPath(minimalRaw, fieldPath)).toBe(false);
    }
  });

  it('uses default storage paths when storage is omitted', async () => {
    const configPath = await writeTempConfig('default-storage-config.json', {
      report: {},
      model: {
        provider: 'openai',
        model: 'gpt-test',
      },
    });

    const resolved = await loadConfig(configPath);

    expect(resolved.config.storage.databasePath).toBe(
      path.join(path.dirname(configPath), 'openfinance.sqlite'),
    );
    expect(resolved.config.reports).toEqual([]);
    expect(resolved.config.notify.smtp).toBeUndefined();
  });

  it('exposes structured validation errors for invalid configs', async () => {
    const configPath = await writeTempConfig('invalid-config.json', {});

    await expect(loadConfig(configPath)).rejects.toMatchObject({
      name: 'ConfigValidationError',
      configPath,
      validationErrors: expect.any(Array),
    } satisfies Partial<ConfigValidationError>);
  });

  it('validates all named report schedule kinds and rejects invalid ids', async () => {
    const base = {
      report: {},
      model: { provider: 'openai', model: 'gpt-test' },
    };
    const configPath = await writeTempConfig('named-reports-config.json', {
      ...base,
      reports: [
        {
          id: 'daily',
          name: 'Daily',
          schedule: { kind: 'daily', time: '08:00' },
          window: { kind: 'last-complete-day' },
          prompts: ['daily.md'],
        },
        {
          id: 'monthly',
          name: 'Monthly',
          schedule: { kind: 'monthly', day: 'last', time: '09:30' },
          window: { kind: 'last-complete-month' },
          prompts: ['monthly.md'],
        },
        {
          id: 'manual-only',
          name: 'Manual',
          schedule: { kind: 'manual' },
          window: { kind: 'last-complete-week' },
          prompts: ['manual.md'],
        },
      ],
    });

    const resolved = await loadConfig(configPath);
    expect(resolved.config.reports.map((report) => report.schedule.kind)).toEqual([
      'daily',
      'monthly',
      'manual',
    ]);

    const reservedPath = await writeTempConfig('reserved-report-config.json', {
      ...base,
      reports: [
        {
          id: 'chat',
          name: 'Chat',
          schedule: { kind: 'manual' },
          window: { kind: 'last-complete-week' },
          prompts: ['chat.md'],
        },
      ],
    });
    await expect(loadConfig(reservedPath)).rejects.toThrow('reserved report route name');

    const duplicatePath = await writeTempConfig('duplicate-report-config.json', {
      ...base,
      reports: [
        {
          id: 'weekly',
          name: 'First',
          schedule: { kind: 'manual' },
          window: { kind: 'last-complete-week' },
          prompts: ['first.md'],
        },
        {
          id: 'weekly',
          name: 'Second',
          schedule: { kind: 'manual' },
          window: { kind: 'last-complete-week' },
          prompts: ['second.md'],
        },
      ],
    });
    await expect(loadConfig(duplicatePath)).rejects.toThrow('must be unique');

    const unsupportedLanguagePath = await writeTempConfig('unsupported-language-config.json', {
      ...base,
      reports: [
        {
          id: 'weekly',
          name: 'Weekly',
          schedule: { kind: 'manual' },
          window: { kind: 'last-complete-week' },
          prompts: ['weekly.md'],
          language: 'es-ES',
        },
      ],
    });
    await expect(loadConfig(unsupportedLanguagePath)).rejects.toThrow('must be equal to one of');
  });

  it('rejects OpenAI reasoning effort on other providers', async () => {
    const configPath = await writeTempConfig('invalid-reasoning-provider.json', {
      report: {},
      model: {
        provider: 'anthropic',
        model: 'claude-test',
        reasoningEffort: 'low',
      },
    });

    await expect(loadConfig(configPath)).rejects.toThrow(
      'reasoningEffort is valid only for provider openai',
    );
  });
});

const defaultedExampleFields: readonly {
  readonly path: readonly string[];
  readonly value: unknown;
}[] = [
  { path: ['sync', 'forceBeforeFetch'], value: DEFAULT_SYNC.forceBeforeFetch },
  { path: ['sync', 'forceUpsert'], value: DEFAULT_SYNC.forceUpsert },
  { path: ['sync', 'lookbackDays'], value: DEFAULT_SYNC.lookbackDays },
  { path: ['sync', 'pageSize'], value: DEFAULT_SYNC.pageSize },
  {
    path: ['reports', '0', 'language'],
    value: 'pt-BR',
  },
  {
    path: ['reports', '1', 'language'],
    value: 'pt-BR',
  },
  {
    path: ['reports', '0', 'agentBudget', 'analystMaxSteps'],
    value: DEFAULT_REPORT_AGENT_BUDGET.analystMaxSteps,
  },
  {
    path: ['reports', '0', 'agentBudget', 'reviewerMaxSteps'],
    value: DEFAULT_REPORT_AGENT_BUDGET.reviewerMaxSteps,
  },
  {
    path: ['reports', '0', 'agentBudget', 'reviewerRounds'],
    value: DEFAULT_REPORT_AGENT_BUDGET.reviewerRounds,
  },
  {
    path: ['reports', '1', 'agentBudget', 'analystMaxSteps'],
    value: DEFAULT_REPORT_AGENT_BUDGET.analystMaxSteps,
  },
  {
    path: ['reports', '1', 'agentBudget', 'reviewerMaxSteps'],
    value: DEFAULT_REPORT_AGENT_BUDGET.reviewerMaxSteps,
  },
  {
    path: ['reports', '1', 'agentBudget', 'reviewerRounds'],
    value: DEFAULT_REPORT_AGENT_BUDGET.reviewerRounds,
  },
  {
    path: ['intelligence', 'suggestionConfidenceThreshold'],
    value: DEFAULT_INTELLIGENCE.suggestionConfidenceThreshold,
  },
  {
    path: ['annotation', 'similarityThreshold'],
    value: DEFAULT_ANNOTATION.similarityThreshold,
  },
  {
    path: ['annotation', 'pushCategoriesUpstream'],
    value: DEFAULT_ANNOTATION.pushCategoriesUpstream,
  },
  { path: ['report', 'includeUnannotated'], value: DEFAULT_REPORT.includeUnannotated },
  {
    path: ['intelligence', 'minReportedItemAmountCents'],
    value: DEFAULT_INTELLIGENCE.minReportedItemAmountCents,
  },
  {
    path: ['intelligence', 'rareLookbackYears'],
    value: DEFAULT_INTELLIGENCE.rareLookbackYears,
  },
  { path: ['notify', 'smtp', 'port'], value: DEFAULT_SMTP.port },
  { path: ['notify', 'smtp', 'secure'], value: DEFAULT_SMTP.secure },
];

function readPath(value: unknown, fieldPath: readonly string[]): unknown {
  let current = value;
  for (const key of fieldPath) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function hasOwnPath(value: unknown, fieldPath: readonly string[]): boolean {
  let current = value;
  for (const key of fieldPath) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, key)) {
      return false;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return true;
}

async function writeTempConfig(filename: string, config: object): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'lof-config-'));
  tempDirs.push(dir);
  const configPath = path.join(dir, filename);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return configPath;
}
