import { clsx } from 'clsx';
import { type ReactNode, useState } from 'react';
import { MdExpandMore } from 'react-icons/md';

export function SidebarSection({
  title,
  children,
  className,
  defaultOpen = true,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={clsx('border-b border-border pb-3 last:border-b-0', className)}>
      <button
        type="button"
        className="flex w-full items-center gap-1 text-left"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <MdExpandMore
          aria-hidden
          className={clsx(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
      </button>
      {open && <div className="mt-2 space-y-2">{children}</div>}
    </section>
  );
}
