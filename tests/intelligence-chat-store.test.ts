import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { insertIntelligenceRun } from '../src/db/intelligence.js';
import {
  buildIntelligenceChatId,
  claimIntelligenceChatGeneration,
  completeIntelligenceChatGeneration,
  getIntelligenceChat,
  releaseIntelligenceChatGeneration,
  saveIntelligenceChat,
} from '../src/db/intelligence-chat.js';
import { migrateDatabase } from '../src/db/migrate.js';

describe('intelligence chat store', () => {
  it('keeps current and seeded transcripts scoped to one report', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    insertIntelligenceRun(db, {
      id: 'run-1',
      reportId: 'weekly',
      periodStart: '2026-08-10',
      periodEnd: '2026-08-16',
      subject: 'Weekly',
      alertCount: 0,
      briefingJson: '{}',
      markdown: 'Stable.',
      html: '<p>Stable.</p>',
      citedTransactionIdsJson: '[]',
    });
    const messagesJson = JSON.stringify([
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Why?' }] },
    ]);

    saveIntelligenceChat(db, { reportId: 'weekly', seedRunId: 'run-1', messagesJson });

    expect(buildIntelligenceChatId('weekly', 'run-1')).toBe('weekly:run:run-1');
    expect(getIntelligenceChat(db, 'weekly', 'run-1')).toMatchObject({
      reportId: 'weekly',
      seedRunId: 'run-1',
      messagesJson,
    });
    expect(getIntelligenceChat(db, 'weekly', null)).toBeNull();
    expect(getIntelligenceChat(db, 'daily', 'run-1')).toBeNull();
  });

  it('uses an ownership token for overlapping generation claims', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    const first = claimIntelligenceChatGeneration(db, 'weekly', null, '2026-08-17T08:00:00.000Z');

    expect(first).toEqual(expect.any(String));
    expect(
      claimIntelligenceChatGeneration(db, 'weekly', null, '2026-08-17T08:00:01.000Z'),
    ).toBeNull();
    releaseIntelligenceChatGeneration(db, 'weekly', null, 'wrong-token');
    expect(
      claimIntelligenceChatGeneration(db, 'weekly', null, '2026-08-17T08:00:02.000Z'),
    ).toBeNull();

    completeIntelligenceChatGeneration(db, {
      reportId: 'weekly',
      seedRunId: null,
      token: first ?? '',
      messagesJson: '[{"id":"assistant-1","role":"assistant","parts":[]}]',
    });
    expect(getIntelligenceChat(db, 'weekly', null)?.messagesJson).toContain('assistant-1');
  });
});
