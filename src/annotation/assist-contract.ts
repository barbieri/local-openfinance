import { z } from 'zod';
import type { AnnotationAssistProposal } from '../scoring/providers.js';

export type AnnotationAssistStatus =
  | 'ok'
  | 'missing_embedding_config'
  | 'missing_classifier_config'
  | 'no_candidates'
  | 'no_suggestion';

export type AnnotationAssistResult = {
  readonly status: AnnotationAssistStatus;
  readonly examples: readonly AnnotationAssistExample[];
  readonly proposal: AnnotationAssistProposal | null;
  readonly usedClassifier: boolean;
  readonly confidence: number | null;
  readonly fromCache?: boolean;
};

export const assistMatchKindSchema = z.enum(['peer_account', 'peer', 'merchant', 'embedding']);

export type AssistMatchKind = z.infer<typeof assistMatchKindSchema>;

export const annotationAssistExampleSchema = z
  .object({
    entryId: z.string(),
    occurredAt: z.string(),
    similarity: z.number(),
    merchantSimilarity: z.number(),
    matchKind: assistMatchKindSchema,
    peerDocumentKey: z.string().nullable(),
    sameAccount: z.boolean(),
    featureText: z.string(),
    categoryOverrideId: z.string().nullable(),
    effectiveCategoryId: z.string().nullable(),
    categoryId: z.string().nullable(),
    subCategoryId: z.string().nullable(),
    categoryName: z.string().nullable(),
    subCategoryName: z.string().nullable(),
    labelIds: z.array(z.string()).readonly(),
    labelNames: z.array(z.string()).readonly(),
    notes: z.string().nullable(),
    merchantName: z.string().nullable(),
    description: z.string().nullable(),
  })
  .readonly();

export type AnnotationAssistExample = z.infer<typeof annotationAssistExampleSchema>;
