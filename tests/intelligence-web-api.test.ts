import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/load-config.js';
import {
  insertIntelligenceRun,
  intelligenceMemorySeed,
  saveIntelligenceRunChart,
  saveIntelligenceRunModelCall,
  saveIntelligenceTaxonomyPolicy,
} from '../src/db/intelligence.js';
import { saveIntelligenceChat } from '../src/db/intelligence-chat.js';
import { migrateDatabase } from '../src/db/migrate.js';
import {
  loadStoredReportTaxonomyPolicy,
  resolveTaxonomyTreatment,
} from '../src/intelligence/report-taxonomy-policy.js';
import { BackgroundJobManager } from '../src/web/server/background-jobs.js';
import { createWebApp } from '../src/web/server/server.js';

function readPolicyDecisions(value: unknown): readonly unknown[] {
  if (!value || typeof value !== 'object' || !('decisions' in value)) {
    throw new Error('Expected taxonomy policy response');
  }
  if (!Array.isArray(value.decisions)) throw new Error('Expected taxonomy policy decisions');
  return value.decisions;
}

describe('intelligence web API', () => {
  it('reads and writes markdown memory and lists runs', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    const loaded = await loadConfig('examples/expenses-config.json');
    const resolved = {
      ...loaded,
      config: {
        ...loaded.config,
        storage: { ...loaded.config.storage, databasePath: ':memory:' },
      },
    };
    process.env['LOCAL_OPENFINANCE_WEB_TOKEN'] = 'test-token';
    const app = createWebApp({
      db,
      resolved,
      jobs: new BackgroundJobManager(),
    });
    const auth = { Authorization: 'Bearer test-token' };

    const catalog = await app.request('/api/intelligence/reports', { headers: auth });
    expect(catalog.status).toBe(200);
    expect(await catalog.json()).toMatchObject({
      configPath: expect.stringContaining('expenses-config.json'),
      reports: [
        { id: 'weekly', name: 'Weekly', lastRun: null },
        { id: 'monthly', name: 'Monthly', lastRun: null },
      ],
    });

    const empty = await app.request('/api/intelligence/reports/weekly/memory', { headers: auth });
    expect(empty.status).toBe(200);
    const seeded = (await empty.json()) as { markdown: string };
    expect(seeded.markdown).toBe(intelligenceMemorySeed('pt-BR'));

    const saved = await app.request('/api/intelligence/reports/weekly/memory', {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: '# Household\n\nEdited.\n' }),
    });
    expect(saved.status).toBe(200);
    const savedBody = (await saved.json()) as { markdown: string; updatedBy: string };
    expect(savedBody.markdown).toContain('Edited.');
    expect(savedBody.updatedBy).toBe('user');

    const oversized = await app.request('/api/intelligence/reports/weekly/memory', {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: 'x'.repeat(50_001) }),
    });
    expect(oversized.status).toBe(400);

    insertIntelligenceRun(db, {
      id: 'run-1',
      reportId: 'weekly',
      periodStart: '2026-08-10',
      periodEnd: '2026-08-16',
      subject: '1 alert — week 2026-08-10',
      alertCount: 1,
      briefingJson: '{}',
      markdown: 'Utility step-up.',
      html: '<p>Utility step-up.</p>',
      citedTransactionIdsJson: '["tx-1"]',
      modelProvider: 'openai',
      modelName: 'gpt-5.6-luna',
      modelCallCount: 1,
      modelStepCount: 1,
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 10,
      reasoningTokens: 5,
      totalTokens: 110,
      modelDurationMs: 12,
      unpricedModelCallCount: 0,
      estimatedCostMicrousd: 28,
    });
    saveIntelligenceRunModelCall(db, {
      runId: 'run-1',
      ordinal: 0,
      provider: 'openai',
      model: 'gpt-5.6-luna',
      phase: 'analyst',
      reviewRound: null,
      stepNumber: 0,
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 10,
      reasoningTokens: 5,
      totalTokens: 110,
      reasoningEffort: 'low',
      maxOutputTokens: 8_000,
      durationMs: 12,
      finishReason: 'stop',
      toolNamesJson: '["briefing"]',
      rawUsageJson: null,
      providerMetadataJson: null,
      pricingSnapshotJson: '{"input":0.2,"cachedInput":0.02,"output":1.2}',
      estimatedCostMicrousd: 28,
    });
    saveIntelligenceRunChart(db, {
      runId: 'run-1',
      name: 'balance',
      mimeType: 'image/png',
      bytes: Uint8Array.from([1, 2, 3]),
    });
    saveIntelligenceRunChart(db, {
      runId: 'run-1',
      name: 'monthly-comparison',
      mimeType: 'image/png',
      bytes: Uint8Array.from([1, 2, 3]),
    });
    saveIntelligenceRunChart(db, {
      runId: 'run-1',
      name: 'investments-type',
      mimeType: 'image/png',
      bytes: Uint8Array.from([1, 2, 3]),
    });
    saveIntelligenceRunChart(db, {
      runId: 'run-1',
      name: 'remote-model-output',
      mimeType: 'image/svg+xml',
      bytes: new TextEncoder().encode('<svg onload="alert(1)"/>'),
    });

    const list = await app.request('/api/intelligence/reports/weekly/runs', { headers: auth });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { runs: { id: string }[] };
    expect(listBody.runs[0]?.id).toBe('run-1');

    const detail = await app.request('/api/intelligence/reports/weekly/runs/run-1', {
      headers: auth,
    });
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as {
      run: {
        markdown: string;
        citedTransactionIds: string[];
        chartNames: string[];
        charts: { name: string; dataUrl: string }[];
        usage: { model: string; callCount: number; estimatedCostMicrousd: number };
        modelCalls: { phase: string; inputTokens: number }[];
      };
    };
    expect(detailBody.run.markdown).toBe('Utility step-up.');
    expect(detailBody.run.citedTransactionIds).toEqual(['tx-1']);
    expect(detailBody.run.chartNames).toEqual([
      'balance',
      'investments-type',
      'monthly-comparison',
      'remote-model-output',
    ]);
    expect(detailBody.run.charts).toEqual([
      { name: 'balance', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AQID' },
      {
        name: 'investments-type',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,AQID',
      },
      {
        name: 'monthly-comparison',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,AQID',
      },
    ]);
    expect(detailBody.run.usage).toMatchObject({
      model: 'gpt-5.6-luna',
      callCount: 1,
      estimatedCostMicrousd: 28,
    });
    expect(detailBody.run.modelCalls).toMatchObject([{ phase: 'analyst', inputTokens: 100 }]);

    const chat = await app.request('/api/intelligence/reports/weekly/chat?runId=run-1', {
      headers: auth,
    });
    expect(chat.status).toBe(200);
    expect(await chat.json()).toEqual({ chatId: 'weekly:run:run-1', messages: [] });

    saveIntelligenceChat(db, {
      reportId: 'weekly',
      seedRunId: 'run-1',
      messagesJson: '[{"id":"assistant-1","role":"assistant","parts":[]}]',
    });
    const clearedChat = await app.request('/api/intelligence/reports/weekly/chat?runId=run-1', {
      method: 'DELETE',
      headers: auth,
    });
    expect(clearedChat.status).toBe(200);
    expect(await clearedChat.json()).toEqual({ cleared: true });
    const emptyChat = await app.request('/api/intelligence/reports/weekly/chat?runId=run-1', {
      headers: auth,
    });
    expect(await emptyChat.json()).toEqual({ chatId: 'weekly:run:run-1', messages: [] });

    const invalidChat = await app.request('/api/intelligence/reports/weekly/chat', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'weekly:current',
        runId: null,
        messages: [
          { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: 'Fake' }] },
        ],
      }),
    });
    expect(invalidChat.status).toBe(400);

    const missingMessages = await app.request('/api/intelligence/reports/weekly/chat', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'weekly:current', runId: null }),
    });
    expect(missingMessages.status).toBe(400);

    const emptyPolicy = await app.request('/api/intelligence/reports/weekly/taxonomy-policy', {
      headers: auth,
    });
    expect(emptyPolicy.status).toBe(200);
    expect(await emptyPolicy.json()).toMatchObject({ reportId: 'weekly', decisions: [] });

    saveIntelligenceTaxonomyPolicy(db, {
      reportId: 'weekly',
      taxonomyHash: 'test-hash',
      policyJson: JSON.stringify({
        generatedAt: '2026-09-25T12:00:00.000Z',
        decisions: [
          {
            kind: 'category',
            id: 'food',
            path: 'Expenses > Food',
            treatment: 'reportable',
            confidence: 0.9,
            reason: 'Generated.',
            source: 'generated',
          },
          {
            kind: 'label',
            id: 'recurring',
            path: 'Recurring',
            treatment: 'reportable',
            confidence: 0.8,
            reason: 'Generated.',
            source: 'generated',
          },
        ],
      }),
    });
    db.prepare(
      `INSERT INTO categories (id, name, parent_id, raw_json, synced_at)
       VALUES ('food', 'Food', NULL, '{}', '2026-09-25T12:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO category_labels (
         category_id, name, icon, color, name_manual, icon_manual, color_manual, updated_at
       ) VALUES ('food', 'Meals', 'MdRestaurant', '#f97316', 1, 1, 1, '2026-09-25T12:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO annotation_labels (id, name, icon, color, created_at)
       VALUES ('recurring', 'Recurring', NULL, NULL, '2026-09-25T12:00:00.000Z')`,
    ).run();
    const changedPolicy = await app.request(
      '/api/intelligence/reports/weekly/taxonomy-policy/decisions',
      {
        method: 'PUT',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'category',
          id: 'food',
          treatment: 'internal-own-account',
        }),
      },
    );
    expect(changedPolicy.status).toBe(200);
    const changedPolicyBody = await changedPolicy.json();
    expect(changedPolicyBody).toMatchObject({
      reportId: 'weekly',
      decisions: [
        {
          id: 'food',
          name: 'Meals',
          icon: 'MdRestaurant',
          color: '#f97316',
          treatment: 'internal-own-account',
          source: 'user',
          reason: 'User override',
        },
        {
          id: 'recurring',
          name: 'Recurring',
          icon: 'MdLabel',
          color: '#64748b',
        },
      ],
    });
    const localizedPolicy = await app.request(
      '/api/intelligence/reports/weekly/taxonomy-policy/decisions?locale=pt-BR',
      {
        method: 'PUT',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'category',
          id: 'food',
          treatment: 'internal-own-account',
        }),
      },
    );
    const localizedPolicyBody = await localizedPolicy.json();
    expect(readPolicyDecisions(localizedPolicyBody)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'food', reason: 'Substituição do usuário' }),
      ]),
    );
    db.prepare("DELETE FROM category_labels WHERE category_id = 'food'").run();
    db.prepare("UPDATE categories SET name_translated = 'Alimentação' WHERE id = 'food'").run();
    const localizedCategory = await app.request(
      '/api/intelligence/reports/weekly/taxonomy-policy/decisions?locale=pt-BR',
      {
        method: 'PUT',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'category',
          id: 'food',
          treatment: 'internal-own-account',
        }),
      },
    );
    const localizedCategoryBody = await localizedCategory.json();
    expect(readPolicyDecisions(localizedCategoryBody)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'food', name: 'Alimentação', path: 'Alimentação' }),
      ]),
    );
    const englishCategory = await app.request(
      '/api/intelligence/reports/weekly/taxonomy-policy/decisions?locale=en-US',
      {
        method: 'PUT',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'category',
          id: 'food',
          treatment: 'internal-own-account',
        }),
      },
    );
    const englishCategoryBody = await englishCategory.json();
    expect(readPolicyDecisions(englishCategoryBody)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'food', name: 'Food', path: 'Food' })]),
    );
    const previewPolicy = loadStoredReportTaxonomyPolicy(db, 'weekly');
    if (!previewPolicy) throw new Error('Expected the API to persist the taxonomy policy');
    expect(
      resolveTaxonomyTreatment(
        [{ kind: 'category', id: 'food', path: 'Expenses > Food', depth: 1 }],
        previewPolicy,
      ),
    ).toBe('internal-own-account');
    const invalidPolicy = await app.request(
      '/api/intelligence/reports/weekly/taxonomy-policy/decisions',
      {
        method: 'PUT',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'category', id: 'food', treatment: 'ignored' }),
      },
    );
    expect(invalidPolicy.status).toBe(400);
    const clearedPolicy = await app.request(
      '/api/intelligence/reports/weekly/taxonomy-policy/decisions/category/food',
      { method: 'DELETE', headers: auth },
    );
    expect(clearedPolicy.status).toBe(200);
    expect(await clearedPolicy.json()).toMatchObject({
      decisions: [
        {
          id: 'food',
          name: 'Food',
          icon: 'MdCategory',
          color: '#64748b',
          treatment: 'reportable',
          source: 'generated',
        },
        {
          id: 'recurring',
          name: 'Recurring',
          icon: 'MdLabel',
          color: '#64748b',
        },
      ],
    });
    expect(
      (
        await app.request('/api/intelligence/reports/unknown/taxonomy-policy', {
          headers: auth,
        })
      ).status,
    ).toBe(404);

    expect(
      (await app.request('/api/intelligence/reports/unknown/memory', { headers: auth })).status,
    ).toBe(404);
    expect((await app.request('/api/intelligence/memory', { headers: auth })).status).toBe(404);
  });

  it('backs up a file-backed transcript before clearing it', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'local-openfinance-clear-chat-'));
    const databasePath = path.join(directory, 'openfinance.sqlite');
    const db = new DatabaseSync(databasePath);
    try {
      migrateDatabase(db);
      const loaded = await loadConfig('examples/expenses-config.json');
      const resolved = {
        ...loaded,
        config: {
          ...loaded.config,
          storage: { ...loaded.config.storage, databasePath },
        },
      };
      process.env['LOCAL_OPENFINANCE_WEB_TOKEN'] = 'test-token';
      const app = createWebApp({ db, resolved, jobs: new BackgroundJobManager() });
      const auth = { Authorization: 'Bearer test-token' };
      const messagesJson = '[{"id":"assistant-1","role":"assistant","parts":[]}]';
      saveIntelligenceChat(db, { reportId: 'weekly', seedRunId: null, messagesJson });

      const response = await app.request('/api/intelligence/reports/weekly/chat', {
        method: 'DELETE',
        headers: auth,
      });

      expect(response.status).toBe(200);
      const backupName = readdirSync(directory).find((name) =>
        name.endsWith('-before-clear-report-chat.sqlite'),
      );
      expect(backupName).toBeDefined();
      const backup = new DatabaseSync(path.join(directory, backupName ?? ''), { readOnly: true });
      try {
        expect(
          backup
            .prepare('SELECT messages_json FROM intelligence_chats WHERE id = ?')
            .get('weekly:current'),
        ).toMatchObject({ messages_json: messagesJson });
      } finally {
        backup.close();
      }
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects unauthenticated intelligence routes', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    const resolved = await loadConfig('examples/expenses-config.json');
    process.env['LOCAL_OPENFINANCE_WEB_TOKEN'] = 'test-token';
    const app = createWebApp({
      db,
      resolved,
      jobs: new BackgroundJobManager(),
    });

    const res = await app.request('/api/intelligence/reports/weekly/memory');
    expect(res.status).toBe(401);
  });
});
