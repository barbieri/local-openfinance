export type ScoringModelConfig = {
  readonly provider: string;
  readonly model: string;
  readonly baseUrl?: string | undefined;
  readonly pricing?: ModelPricing | undefined;
};

export type ModelPricing = {
  readonly input: number;
  readonly cachedInput?: number | undefined;
  readonly output?: number | undefined;
};

export type ModelConfig = {
  readonly provider: string;
  readonly model: string;
  readonly baseUrl?: string | undefined;
  readonly temperature?: number | undefined;
  readonly maxOutputTokens?: number | undefined;
  readonly reasoningEffort?:
    | 'none'
    | 'minimal'
    | 'low'
    | 'medium'
    | 'high'
    | 'xhigh'
    | 'max'
    | undefined;
  readonly pricing?: ModelPricing | undefined;
};

export type ReportAgentBudget = {
  readonly analystMaxSteps: number;
  readonly reviewerMaxSteps: number;
  readonly reviewerRounds: number;
};

export type ReportFilters = {
  readonly accountIds?: readonly string[] | undefined;
  readonly includeUnannotated?: boolean | undefined;
};

export type Weekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export type ReportSchedule =
  | { readonly kind: 'daily'; readonly time: string }
  | { readonly kind: 'weekly'; readonly weekday: Weekday; readonly time: string }
  | { readonly kind: 'monthly'; readonly day: number | 'last'; readonly time: string }
  | { readonly kind: 'manual' };

export type ReportWindow =
  | { readonly kind: 'last-complete-day' }
  | { readonly kind: 'last-complete-week' }
  | { readonly kind: 'last-complete-month' };

export type ReportConfig = ReportFilters & {
  readonly id: string;
  readonly name: string;
  readonly schedule: ReportSchedule;
  readonly window: ReportWindow;
  readonly prompts: readonly string[];
  readonly language?: string | undefined;
  readonly send?: 'always' | 'alerts' | 'never' | undefined;
  readonly model?: ModelConfig | undefined;
  readonly agentBudget?: Partial<ReportAgentBudget> | undefined;
};

export type AppConfig = {
  readonly storage?: {
    readonly databasePath?: string | undefined;
  };
  readonly sync?: {
    readonly forceBeforeFetch?: boolean | undefined;
    readonly forceUpsert?: boolean | undefined;
    readonly connections?: readonly string[] | undefined;
    readonly lookbackDays?: number | undefined;
    readonly pageSize?: number | undefined;
  };
  readonly annotation?: {
    readonly embedding?: ScoringModelConfig | undefined;
    readonly classifier?: ScoringModelConfig | undefined;
    readonly similarityThreshold?: number | undefined;
    readonly pushCategoriesUpstream?: boolean | undefined;
  };
  readonly report: ReportFilters;
  readonly reports?: readonly ReportConfig[] | undefined;
  readonly web?: {
    readonly publicBaseUrl?: string | undefined;
  };
  readonly intelligence?: {
    readonly suggestionConfidenceThreshold?: number | undefined;
    readonly minReportedItemAmountCents?: number | undefined;
    readonly rareLookbackYears?: number | undefined;
  };
  readonly chatModel?: ModelConfig | undefined;
  readonly notify?: {
    readonly smtp?: {
      readonly host: string;
      readonly port?: number | undefined;
      readonly secure?: boolean | undefined;
      readonly from: string;
      readonly to: string | readonly string[];
      readonly auth?: {
        readonly user: string;
        readonly passEnvVar: string;
      };
    };
  };
  readonly model: ModelConfig;
};

export type ResolvedAppConfig = Omit<
  AppConfig,
  'report' | 'reports' | 'web' | 'intelligence' | 'chatModel' | 'notify'
> & {
  readonly storage: {
    readonly databasePath: string;
  };
  readonly sync: {
    readonly forceBeforeFetch: boolean;
    readonly forceUpsert: boolean;
    readonly connections: readonly string[];
    readonly lookbackDays: number;
    readonly pageSize: number;
  };
  readonly annotation: {
    readonly embedding: ScoringModelConfig | undefined;
    readonly classifier: ScoringModelConfig | undefined;
    readonly similarityThreshold: number;
    readonly pushCategoriesUpstream: boolean;
  };
  readonly report: {
    readonly accountIds: readonly string[];
    readonly includeUnannotated: boolean;
  };
  readonly reports: readonly ResolvedReportConfig[];
  readonly web: {
    readonly publicBaseUrl: string | undefined;
  };
  readonly intelligence: {
    readonly suggestionConfidenceThreshold: number;
    readonly minReportedItemAmountCents: number;
    readonly rareLookbackYears: number;
  };
  readonly chatModel: ModelConfig | undefined;
  readonly notify: {
    readonly smtp:
      | {
          readonly host: string;
          readonly port: number;
          readonly secure: boolean;
          readonly from: string;
          readonly to: readonly string[];
          readonly auth:
            | {
                readonly user: string;
                readonly passEnvVar: string;
              }
            | undefined;
        }
      | undefined;
  };
};

export type ResolvedReportConfig = {
  readonly id: string;
  readonly name: string;
  readonly schedule: ReportSchedule;
  readonly window: ReportWindow;
  readonly prompts: readonly string[];
  readonly language: string;
  readonly send: 'always' | 'alerts' | 'never';
  readonly model: ModelConfig;
  readonly agentBudget: ReportAgentBudget;
  readonly accountIds: readonly string[];
  readonly includeUnannotated: boolean;
};

export type ResolvedConfig = {
  readonly config: ResolvedAppConfig;
  readonly configPath: string;
  readonly configHash: string;
  readonly topicId: string;
};
