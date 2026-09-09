import { type RefObject, useEffect } from 'react';

type TransactionShortcut =
  | 'search'
  | 'help'
  | 'editSelected'
  | 'toggleAllSelection'
  | 'selectUnclassified'
  | 'toggleCurrentSelection'
  | 'previous'
  | 'next'
  | 'editCurrent';

type Input = {
  readonly dialogOpen: boolean;
  readonly shortcutsOpen: boolean;
  readonly setShortcutsOpen: (open: boolean) => void;
  readonly uiSidebarOpen: boolean;
  readonly setSidebarOpen: (open: boolean) => void;
  readonly searchInputRef: RefObject<HTMLInputElement | null>;
  readonly focusSearchRequestedRef: RefObject<boolean>;
  readonly openEditSelected: () => void;
  readonly selectedCount: number;
  readonly rowCount: number;
  readonly handleSelectNone: () => void;
  readonly handleSelectAllVisible: () => void;
  readonly handleSelectUnclassifiedVisible: () => void;
  readonly toggleCurrentRowSelection: () => void;
  readonly moveCurrentRow: (direction: 'previous' | 'next') => void;
  readonly openCurrentRow: () => void;
};

export function useTransactionPageShortcuts({
  dialogOpen,
  shortcutsOpen,
  setShortcutsOpen,
  uiSidebarOpen,
  setSidebarOpen,
  searchInputRef,
  focusSearchRequestedRef,
  openEditSelected,
  selectedCount,
  rowCount,
  handleSelectNone,
  handleSelectAllVisible,
  handleSelectUnclassifiedVisible,
  toggleCurrentRowSelection,
  moveCurrentRow,
  openCurrentRow,
}: Input): void {
  useEffect(() => {
    const shortcutActions: Record<TransactionShortcut, () => void> = {
      search: () => {
        focusSearchRequestedRef.current = true;
        setSidebarOpen(true);
        if (uiSidebarOpen) {
          focusSearchRequestedRef.current = false;
          focusTransactionSearch(searchInputRef.current);
        }
      },
      help: () => setShortcutsOpen(true),
      editSelected: openEditSelected,
      toggleAllSelection: () => {
        if (selectedCount === rowCount) {
          handleSelectNone();
        } else {
          handleSelectAllVisible();
        }
      },
      selectUnclassified: handleSelectUnclassifiedVisible,
      toggleCurrentSelection: toggleCurrentRowSelection,
      previous: () => moveCurrentRow('previous'),
      next: () => moveCurrentRow('next'),
      editCurrent: openCurrentRow,
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (shouldIgnoreTransactionShortcut(event.target)) {
        return;
      }
      if (dialogOpen || shortcutsOpen) {
        return;
      }

      const shortcut = resolveTransactionShortcut(event.key);
      if (!shortcut) {
        return;
      }

      event.preventDefault();
      shortcutActions[shortcut]();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    dialogOpen,
    focusSearchRequestedRef,
    handleSelectAllVisible,
    handleSelectNone,
    handleSelectUnclassifiedVisible,
    moveCurrentRow,
    openCurrentRow,
    openEditSelected,
    rowCount,
    searchInputRef,
    selectedCount,
    setSidebarOpen,
    setShortcutsOpen,
    shortcutsOpen,
    toggleCurrentRowSelection,
    uiSidebarOpen,
  ]);
}

export function focusTransactionSearch(input: HTMLInputElement | null): void {
  input?.focus();
  input?.select();
}

function shouldIgnoreTransactionShortcut(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return Boolean(target.closest('input, textarea, select, button, [role="textbox"]'));
}

function resolveTransactionShortcut(key: string): TransactionShortcut | null {
  switch (key) {
    case '/':
      return 'search';
    case '?':
    case 'h':
    case 'H':
      return 'help';
    case 'e':
    case 'E':
      return 'editSelected';
    case 's':
    case 'S':
      return 'toggleAllSelection';
    case 'u':
    case 'U':
      return 'selectUnclassified';
    case 'x':
    case 'X':
      return 'toggleCurrentSelection';
    case 'ArrowUp':
      return 'previous';
    case 'ArrowDown':
      return 'next';
    case 'Enter':
      return 'editCurrent';
    default:
      return null;
  }
}
