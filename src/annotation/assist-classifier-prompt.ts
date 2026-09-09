import { type AnnotatableEntry, buildEmbeddingFeatureText } from './feature-text.js';

export type AssistClassifierInput = {
  readonly targetFeatureText: string;
  readonly currentState: {
    readonly categoryOverrideId?: string | null | undefined;
    readonly categoryId: string | null;
    readonly subCategoryId: string | null;
    readonly labelIds: readonly string[];
    readonly labelNames: readonly string[];
    readonly notes: string | null;
  };
  readonly examples: readonly {
    readonly featureText: string;
    readonly categoryOverrideId: string | null;
    readonly effectiveCategoryId: string | null;
    readonly categoryId: string | null;
    readonly subCategoryId: string | null;
    readonly labelIds: readonly string[];
    readonly labelNames: readonly string[];
    readonly notes: string | null;
    readonly matchKind?: string | undefined;
    readonly merchantSimilarity?: number | undefined;
    readonly similarity?: number | undefined;
    readonly peerDocumentKey?: string | null | undefined;
    readonly sameAccount?: boolean | undefined;
  }[];
  readonly openFinanceCategories: readonly {
    readonly id: string;
    readonly name: string;
    readonly path: string;
  }[];
  readonly categories: readonly { readonly id: string; readonly name: string }[];
  readonly labels: readonly { readonly id: string; readonly name: string }[];
};

export type AssistClassifierNotesLeakagePatterns = {
  readonly keyValuePrefixes: ReadonlySet<string>;
  readonly instructionLines: ReadonlySet<string>;
};

export const ASSIST_CLASSIFIER_SYSTEM = [
  'You classify Brazilian personal-finance transactions for a local ledger.',
  'Primary signal: labeled neighbor examples (especially peer_account / peer / merchant matches).',
  'Return ONLY one JSON object. No markdown fences, no prose outside JSON.',
  'Prefer reusing labels and category overrides from strong peer/merchant examples.',
  'Do not invent labels or category ids that are not listed.',
  'notes must almost always be null unless you can add durable user context absent from the target feature text.',
].join(' ');

const SAMPLE_ASSIST_FEATURE_ENTRY: AnnotatableEntry = {
  entryType: 'transaction',
  entryId: 'assist-leakage-sample',
  occurredAt: '2026-01-15T12:00:00.000Z',
  amountCents: -1000,
  currency: 'BRL',
  description: 'Sample description',
  merchantName: 'Sample merchant',
  categoryId: '05000000',
  categoryName: 'Food',
  parentCategoryId: '05000000',
  parentCategoryName: 'Parent',
  accountId: 'acct-sample',
  accountName: 'Checking',
  accountType: 'BANK',
  accountSubtype: 'CHECKING',
  connectionItemId: 'conn-sample',
  connectionName: 'Bank',
  rawJson: JSON.stringify({
    description: 'Sample description',
    merchant: { businessName: 'Biz', cnpj: '00', cnae: '0000', category: 'Retail' },
    creditCardMetadata: { payeeMCC: 5411, purchaseDate: '2026-01-14' },
    paymentData: {
      payer: { type: 'CPF', value: '12345678901' },
      receiver: 'Receiver name',
    },
    amount: -10,
    status: 'POSTED',
  }),
};

let cachedNotesLeakagePatterns: AssistClassifierNotesLeakagePatterns | null = null;

export function buildAssistClassifierPrompt(input: AssistClassifierInput): string {
  const openFinanceCategoryList =
    input.openFinanceCategories.length > 0
      ? input.openFinanceCategories.map((item) => `- ${item.id}: ${item.path}`).join('\n')
      : '(none)';
  const annotationCategoryList =
    input.categories.length > 0
      ? input.categories.map((item) => `- ${item.id}: ${item.name}`).join('\n')
      : '(none)';
  const labelList =
    input.labels.length > 0
      ? input.labels.map((item) => `- ${item.id}: ${item.name}`).join('\n')
      : '(none in similar examples — use labelIds: [])';
  const exampleBlocks = input.examples
    .map((example, index) =>
      [
        `Example ${index + 1}:`,
        example.matchKind ? `match_kind=${example.matchKind}` : null,
        example.peerDocumentKey ? `peer_document=${example.peerDocumentKey}` : null,
        example.sameAccount !== undefined ? `same_account=${example.sameAccount}` : null,
        example.merchantSimilarity !== undefined
          ? `merchant_similarity=${example.merchantSimilarity.toFixed(2)}`
          : null,
        example.similarity !== undefined ? `similarity=${example.similarity.toFixed(2)}` : null,
        example.featureText,
        `open_finance.category_id=${example.categoryOverrideId ?? example.effectiveCategoryId ?? ''}`,
        `annotation.category_id=${example.categoryId ?? ''}`,
        `annotation.sub_category_id=${example.subCategoryId ?? ''}`,
        `annotation.label_ids=${example.labelIds.join(', ')}`,
        `annotation.labels=${example.labelNames.join(', ')}`,
        `annotation.notes=${example.notes ?? ''}`,
      ]
        .filter((line): line is string => line !== null)
        .join('\n'),
    )
    .join('\n\n');

  return [
    'Classify the target transaction using the labeled examples.',
    'Return ONLY a JSON object with keys:',
    'categoryOverrideId (string|null), categoryId (string|null), subCategoryId (string|null), labelIds (string[]), notes (string|null), reasoning (string|null).',
    '',
    'Field rules:',
    '- categoryOverrideId: exact Open Finance category id when the bank category should be corrected; prefer when strong examples disagree with the target synced category.',
    '- categoryId/subCategoryId: optional local annotation taxonomy ids; null when unsure.',
    '- labelIds: at most 3 exact ids from Known labels (ranked from similar examples). Use [] when none apply.',
    '- notes: null unless durable user context is missing from the target feature text.',
    '- Never copy example notes verbatim unless merchant_similarity >= 0.95 or match_kind is peer_account/peer.',
    '- When borrowing phrasing, rewrite dates, amounts, counterparties, and product names for the target.',
    '- Do not repeat transaction dates, amounts, merchant/description text, or example feature text in notes.',
    '- Prefer peer_account then peer then merchant examples over weak embedding-only neighbors.',
    '',
    'Open Finance categories:',
    openFinanceCategoryList,
    '',
    'Optional annotation taxonomy:',
    annotationCategoryList,
    '',
    'Known labels (top from similar examples, max 3):',
    labelList,
    '',
    'Current draft for target entry:',
    `categoryOverrideId=${input.currentState.categoryOverrideId ?? ''}`,
    `categoryId=${input.currentState.categoryId ?? ''}`,
    `subCategoryId=${input.currentState.subCategoryId ?? ''}`,
    `labelIds=${input.currentState.labelIds.join(', ')}`,
    `notes=${input.currentState.notes ?? ''}`,
    '',
    'Similar labeled examples (best first):',
    exampleBlocks.length > 0 ? exampleBlocks : '(none)',
    '',
    'Target entry feature text:',
    input.targetFeatureText,
  ].join('\n');
}

function buildSampleAssistClassifierInput(): AssistClassifierInput {
  const featureText = buildEmbeddingFeatureText(SAMPLE_ASSIST_FEATURE_ENTRY);
  return {
    targetFeatureText: featureText,
    currentState: {
      categoryOverrideId: '05000000',
      categoryId: 'local-cat',
      subCategoryId: 'local-sub',
      labelIds: ['label-a'],
      labelNames: ['Label A'],
      notes: 'Draft note',
    },
    examples: [
      {
        featureText,
        categoryOverrideId: '05080000',
        effectiveCategoryId: '05000000',
        categoryId: 'local-cat',
        subCategoryId: 'local-sub',
        labelIds: ['label-a', 'label-b'],
        labelNames: ['Label A', 'Label B'],
        notes: 'Example annotation note',
        matchKind: 'peer_account',
        peerDocumentKey: 'cnpj:12345678000199',
        sameAccount: true,
        merchantSimilarity: 0.95,
        similarity: 0.97,
      },
    ],
    openFinanceCategories: [
      { id: '05000000', name: 'Food', path: 'Food' },
      { id: '05080000', name: 'Restaurants', path: 'Food > Restaurants' },
    ],
    categories: [{ id: 'local-cat', name: 'Local category' }],
    labels: [
      { id: 'label-a', name: 'Label A' },
      { id: 'label-b', name: 'Label B' },
    ],
  };
}

export function stripAssistClassifierMarkdownLine(line: string): string {
  return line.trim().replace(/^[-*+]\s+/, '');
}

const KEY_VALUE_LINE_PREFIX_RE = /^([^=]+)=/;

function readKeyValueLinePrefix(line: string): string | null {
  const match = KEY_VALUE_LINE_PREFIX_RE.exec(line);
  return match?.[1] ?? null;
}

export function extractAssistClassifierNotesLeakagePatterns(
  prompt: string,
): AssistClassifierNotesLeakagePatterns {
  const keyValuePrefixes = new Set<string>();
  const instructionLines = new Set<string>();

  for (const line of prompt.split('\n')) {
    const stripped = stripAssistClassifierMarkdownLine(line);
    if (!stripped) {
      continue;
    }

    const keyValuePrefix = readKeyValueLinePrefix(stripped);
    if (keyValuePrefix) {
      keyValuePrefixes.add(keyValuePrefix.toLowerCase());
      continue;
    }

    instructionLines.add(stripped.toLowerCase());
  }

  return { keyValuePrefixes, instructionLines };
}

export function buildAssistClassifierNotesLeakagePatterns(): AssistClassifierNotesLeakagePatterns {
  return extractAssistClassifierNotesLeakagePatterns(
    buildAssistClassifierPrompt(buildSampleAssistClassifierInput()),
  );
}

export function getAssistClassifierNotesLeakagePatterns(): AssistClassifierNotesLeakagePatterns {
  cachedNotesLeakagePatterns ??= buildAssistClassifierNotesLeakagePatterns();
  return cachedNotesLeakagePatterns;
}

function isNoteLineKeyValueLeak(line: string, keyValuePrefixes: ReadonlySet<string>): boolean {
  const stripped = stripAssistClassifierMarkdownLine(line).toLowerCase();
  const prefix = readKeyValueLinePrefix(stripped);
  if (!prefix) {
    return false;
  }
  return keyValuePrefixes.has(prefix);
}

export function isAssistClassifierPromptNotesLeakage(
  notes: string,
  patterns: AssistClassifierNotesLeakagePatterns = getAssistClassifierNotesLeakagePatterns(),
): boolean {
  const trimmed = notes.trim();
  if (!trimmed) {
    return false;
  }

  const normalizedFull = stripAssistClassifierMarkdownLine(trimmed).toLowerCase();
  if (patterns.instructionLines.has(normalizedFull)) {
    return true;
  }

  const lines = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return false;
  }

  return lines.every((line) => {
    const normalized = stripAssistClassifierMarkdownLine(line).toLowerCase();
    if (patterns.instructionLines.has(normalized)) {
      return true;
    }
    return isNoteLineKeyValueLeak(line, patterns.keyValuePrefixes);
  });
}
