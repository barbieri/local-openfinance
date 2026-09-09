import type { ReactNode } from 'react';
import { MdChevronRight } from 'react-icons/md';

export function CollapsibleSidebarToggle({
  label,
  onClick,
  summary,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly summary?: ReactNode;
}) {
  return (
    <div className="inline-flex max-w-full items-center gap-1 rounded border border-border bg-background px-3 py-1 text-sm">
      <button
        type="button"
        className="inline-flex shrink-0 items-center gap-1 hover:text-foreground"
        onClick={onClick}
      >
        <MdChevronRight className="size-4 shrink-0 rotate-180" aria-hidden />
        <span className="font-medium">{label}</span>
      </button>
      {summary}
    </div>
  );
}
