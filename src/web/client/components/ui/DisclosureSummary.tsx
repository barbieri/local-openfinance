import type { ReactNode } from 'react';
import { MdExpandMore } from 'react-icons/md';

export function DisclosureSummary({ children }: { readonly children: ReactNode }) {
  return (
    <summary className="flex cursor-pointer list-none items-start gap-1.5 px-2 py-1 text-sm [&::-webkit-details-marker]:hidden">
      <MdExpandMore
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
      />
      <div className="min-w-0 flex flex-1 flex-wrap items-center gap-x-1 gap-y-1">{children}</div>
    </summary>
  );
}
