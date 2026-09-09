export type SyncItemCounts = {
  readonly connections?: number;
  readonly categories?: number;
  readonly accounts?: number;
  readonly investments?: number;
  readonly loans?: number;
  readonly transactions?: number;
  readonly creditCardBills?: number;
  readonly investmentTransactions?: number;
};

export type SyncUiEvent =
  | { readonly type: 'phase'; readonly phase: string; readonly detail?: string }
  | {
      readonly type: 'step';
      readonly current: number;
      readonly total?: number;
      readonly detail?: string;
    }
  | { readonly type: 'trail'; readonly label: string; readonly counts: SyncItemCounts }
  | { readonly type: 'done' }
  | { readonly type: 'error'; readonly message: string };

export type SyncUiState = {
  readonly live: SyncUiEvent | null;
  readonly trails: { readonly label: string; readonly counts: SyncItemCounts }[];
  readonly error: string | null;
  readonly done: boolean;
};

export function applySyncEvent(state: SyncUiState, event: SyncUiEvent): SyncUiState {
  switch (event.type) {
    case 'phase':
    case 'step':
      return { ...state, live: event };
    case 'trail':
      return {
        ...state,
        live: null,
        trails: [...state.trails, { label: event.label, counts: event.counts }],
      };
    case 'done':
      return { ...state, live: null, done: true };
    case 'error':
      return { ...state, live: null, error: event.message };
    default:
      return state;
  }
}
