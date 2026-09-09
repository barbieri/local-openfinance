import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { TransactionGroupByField } from './transaction-row-grouping.js';

export type TableUrlState = {
  readonly f: Record<string, string | string[]>;
  readonly g?: readonly TransactionGroupByField[];
  readonly c?: string[];
  readonly o?: { readonly id: string; readonly desc?: boolean }[];
  readonly p?: number;
  readonly ps?: number;
  readonly display?: {
    readonly category?: 'icon' | 'short' | 'full';
    readonly labels?: 'icon' | 'short' | 'full';
    readonly date?: 'credit-purchase';
  };
  readonly charts?: {
    readonly open?: boolean;
    readonly tab?: TransactionChartTab;
  };
};

export type TransactionChartTab = 'balance' | 'category' | 'label';

export function encodeTableState(state: TableUrlState): string {
  return compressToEncodedURIComponent(JSON.stringify(state));
}

export function decodeTableState(encoded: string): TableUrlState | null {
  try {
    const json = decompressFromEncodedURIComponent(encoded);
    if (!json) {
      return null;
    }
    return JSON.parse(json) as TableUrlState;
  } catch {
    return null;
  }
}
