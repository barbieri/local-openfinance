import { useCallback, useReducer } from 'react';
import type {
  DetectTransfersSummary,
  TransferPairProposal,
} from '../components/transactions/DetectTransfersDialog.js';
import type { TransactionDetailRow } from '../components/transactions/TransactionDetailDialog.js';

export type TransactionRow = TransactionDetailRow;

export type TransactionsPageUiState = {
  readonly selected: readonly string[];
  readonly classifyQueue: readonly TransactionRow[];
  readonly classifyIndex: number;
  readonly detectOpen: boolean;
  readonly detectProposals: readonly TransferPairProposal[];
  readonly detectSummary: DetectTransfersSummary | null;
  readonly sidebarOpen: boolean;
  readonly detailTransaction: TransactionRow | null;
  readonly detailEditIds: readonly string[];
  readonly detailEditIndex: number;
};

const INITIAL_TRANSACTIONS_PAGE_UI_STATE: TransactionsPageUiState = {
  selected: [],
  classifyQueue: [],
  classifyIndex: 0,
  detectOpen: false,
  detectProposals: [],
  detectSummary: null,
  sidebarOpen: false,
  detailTransaction: null,
  detailEditIds: [],
  detailEditIndex: 0,
};

type TransactionsPageUiAction =
  | {
      readonly type: 'patchSelected';
      readonly patch: (current: readonly string[]) => readonly string[];
    }
  | { readonly type: 'selectAll'; readonly ids: readonly string[] }
  | { readonly type: 'selectNone' }
  | {
      readonly type: 'openDetail';
      readonly transaction: TransactionRow;
      readonly editIds: readonly string[];
      readonly editIndex: number;
    }
  | { readonly type: 'closeDetail' }
  | {
      readonly type: 'advanceDetailEdit';
      readonly transaction: TransactionRow | null;
      readonly editIndex: number;
      readonly editIds: readonly string[];
    }
  | {
      readonly type: 'openDetect';
      readonly proposals: readonly TransferPairProposal[];
      readonly summary: DetectTransfersSummary;
    }
  | { readonly type: 'closeDetect' }
  | { readonly type: 'setSidebarOpen'; readonly open: boolean }
  | { readonly type: 'clearClassify' }
  | { readonly type: 'advanceClassify' }
  | {
      readonly type: 'setClassifyQueue';
      readonly queue: readonly TransactionRow[];
      readonly index: number;
    };

function transactionsPageUiReducer(
  state: TransactionsPageUiState,
  action: TransactionsPageUiAction,
): TransactionsPageUiState {
  switch (action.type) {
    case 'patchSelected':
      return { ...state, selected: action.patch(state.selected) };
    case 'selectAll':
      return { ...state, selected: action.ids };
    case 'selectNone':
      return { ...state, selected: [] };
    case 'openDetail':
      return {
        ...state,
        detailTransaction: action.transaction,
        detailEditIds: action.editIds,
        detailEditIndex: action.editIndex,
      };
    case 'closeDetail':
      return {
        ...state,
        detailTransaction: null,
        detailEditIds: [],
        detailEditIndex: 0,
      };
    case 'advanceDetailEdit':
      return {
        ...state,
        detailTransaction: action.transaction,
        detailEditIds: action.editIds,
        detailEditIndex: action.editIndex,
      };
    case 'openDetect':
      return {
        ...state,
        detectOpen: true,
        detectProposals: action.proposals,
        detectSummary: action.summary,
      };
    case 'closeDetect':
      return { ...state, detectOpen: false };
    case 'setSidebarOpen':
      return { ...state, sidebarOpen: action.open };
    case 'clearClassify':
      return { ...state, classifyQueue: [], classifyIndex: 0 };
    case 'advanceClassify':
      return { ...state, classifyIndex: state.classifyIndex + 1 };
    case 'setClassifyQueue':
      return { ...state, classifyQueue: action.queue, classifyIndex: action.index };
    default:
      return state;
  }
}

export function useTransactionsPageUiState() {
  const [ui, dispatch] = useReducer(transactionsPageUiReducer, INITIAL_TRANSACTIONS_PAGE_UI_STATE);

  const patchSelected = useCallback((patch: (current: readonly string[]) => readonly string[]) => {
    dispatch({ type: 'patchSelected', patch });
  }, []);

  const selectAllVisible = useCallback((ids: readonly string[]) => {
    dispatch({ type: 'selectAll', ids });
  }, []);

  const selectNone = useCallback(() => {
    dispatch({ type: 'selectNone' });
  }, []);

  const openDetail = useCallback(
    (transaction: TransactionRow, editIds: readonly string[], editIndex: number) => {
      dispatch({ type: 'openDetail', transaction, editIds, editIndex });
    },
    [],
  );

  const closeDetail = useCallback(() => {
    dispatch({ type: 'closeDetail' });
  }, []);

  const advanceDetailEdit = useCallback(
    (transaction: TransactionRow | null, editIds: readonly string[], editIndex: number) => {
      dispatch({ type: 'advanceDetailEdit', transaction, editIds, editIndex });
    },
    [],
  );

  const openDetect = useCallback(
    (proposals: readonly TransferPairProposal[], summary: DetectTransfersSummary) => {
      dispatch({ type: 'openDetect', proposals, summary });
    },
    [],
  );

  const closeDetect = useCallback(() => {
    dispatch({ type: 'closeDetect' });
  }, []);

  const setSidebarOpen = useCallback((open: boolean) => {
    dispatch({ type: 'setSidebarOpen', open });
  }, []);

  const clearClassify = useCallback(() => {
    dispatch({ type: 'clearClassify' });
  }, []);

  const advanceClassify = useCallback(() => {
    dispatch({ type: 'advanceClassify' });
  }, []);

  return {
    ui,
    patchSelected,
    selectAllVisible,
    selectNone,
    openDetail,
    closeDetail,
    advanceDetailEdit,
    openDetect,
    closeDetect,
    setSidebarOpen,
    clearClassify,
    advanceClassify,
  };
}
