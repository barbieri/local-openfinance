import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseAppHash, replaceAppHash } from '../lib/app-hash.js';
import { decodeTableState, encodeTableState, type TableUrlState } from '../lib/table-url-state.js';

export type { TableUrlState } from '../lib/table-url-state.js';
export { decodeTableState, encodeTableState } from '../lib/table-url-state.js';

function readTableStateFromHash(tabId: string): TableUrlState | null {
  const parsed = parseAppHash();
  if (parsed.route !== 'tab' || parsed.tab !== 'transactions' || !parsed.tableStateEncoded) {
    return null;
  }
  const tableStateEncoded = parsed.tableStateEncoded;
  const decoded = decodeTableState(tableStateEncoded);
  if (!decoded || (decoded as { t?: string }).t !== tabId) {
    return null;
  }
  return decoded;
}

export function useTableUrlState(
  tabId: string,
  defaults: TableUrlState,
): [TableUrlState, (next: TableUrlState | ((prev: TableUrlState) => TableUrlState)) => void] {
  const [state, setState] = useState<TableUrlState>(() => {
    const fromHash = readTableStateFromHash(tabId);
    return fromHash ?? defaults;
  });

  const persist = useCallback(
    (next: TableUrlState | ((prev: TableUrlState) => TableUrlState)) => {
      setState((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        const encoded = encodeTableState({ ...resolved, t: tabId } as TableUrlState & {
          t: string;
        });
        replaceAppHash('transactions', encoded);
        return resolved;
      });
    },
    [tabId],
  );

  useEffect(() => {
    const onHashChange = (): void => {
      const fromHash = readTableStateFromHash(tabId);
      if (fromHash) {
        setState(fromHash);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [tabId]);

  return useMemo(() => [state, persist], [state, persist]);
}
