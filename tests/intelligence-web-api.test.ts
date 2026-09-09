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
} from '../src/db/intelligence.js';
import { saveIntelligenceChat } from '../src/db/intelligence-chat.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { BackgroundJobManager } from '../src/web/server/background-jobs.js';
import { createWebApp } from '../src/web/server/server.js';

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
    expect(detailBody.run.chartNames).toEqual(['balance', 'remote-model-output']);
    expect(detailBody.run.charts).toEqual([
      { name: 'balance', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AQID' },
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
