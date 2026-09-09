import { clsx } from 'clsx';
import { type ReactNode, useEffect, useEffectEvent } from 'react';
import { createPortal } from 'react-dom';
import { MdClose } from 'react-icons/md';

type CollapsibleSidebarProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly closeLabel: string;
  readonly children: ReactNode;
  readonly className?: string;
};

export function CollapsibleSidebar({
  open,
  onOpenChange,
  title,
  closeLabel,
  children,
  className,
}: CollapsibleSidebarProps) {
  const onOpenChangeEvent = useEffectEvent(onOpenChange);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onOpenChangeEvent(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        className="absolute inset-0 bg-black/20"
        aria-label={closeLabel}
        onClick={() => onOpenChange(false)}
      />
      <aside
        className={clsx(
          'absolute top-0 right-0 flex h-full w-[max(500px,50vw)] max-w-[50vw] flex-col border-l border-border bg-background shadow-xl',
          '[@media(orientation:portrait)_and_(max-width:767px)]:w-full [@media(orientation:portrait)_and_(max-width:767px)]:max-w-full',
          className,
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title={closeLabel}
            aria-label={closeLabel}
            onClick={() => onOpenChange(false)}
          >
            <MdClose className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
