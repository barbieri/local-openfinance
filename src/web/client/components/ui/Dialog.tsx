import { type ReactNode, useEffectEvent, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MdClose } from 'react-icons/md';

type DialogProps = {
  readonly open: boolean;
  readonly title: ReactNode;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly size?: 'md' | 'lg' | 'xl' | 'wide';
};

const sizeClass = {
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  wide: 'max-sm:fixed max-sm:inset-0 max-sm:m-0 max-sm:h-full max-sm:w-full max-sm:max-w-none max-sm:rounded-none sm:w-[75vw] sm:min-w-[650px] sm:max-w-[75vw]',
} as const;

export function Dialog({ open, title, onClose, children, footer, size = 'md' }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const onCloseEvent = useEffectEvent(onClose);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (!dialog.open) {
      dialog.showModal();
    }

    const handleClose = (): void => {
      onCloseEvent();
    };
    dialog.addEventListener('close', handleClose);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      dialog.removeEventListener('close', handleClose);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  if (!open) {
    return null;
  }

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby="dialog-title"
      className={`fixed inset-0 z-50 m-auto flex w-full flex-col overflow-hidden border border-border bg-background p-0 shadow-xl backdrop:bg-black/40 ${sizeClass[size]} max-sm:h-full max-sm:max-h-none rounded-lg`}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-background px-4 py-3">
        <h2 id="dialog-title" className="text-base font-semibold tabular-nums">
          {title}
        </h2>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-muted"
          onClick={onClose}
          aria-label="Close"
        >
          <MdClose className="size-5" />
        </button>
      </div>
      <div className="max-h-[75vh] min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-background px-4 py-3 max-sm:max-h-none">
        {children}
      </div>
      {footer && (
        <div className="flex w-full shrink-0 justify-end gap-2 border-t border-border bg-background px-4 py-3">
          {footer}
        </div>
      )}
    </dialog>,
    document.body,
  );
}
