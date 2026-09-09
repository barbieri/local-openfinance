import { clsx } from 'clsx';
import type { ReactNode } from 'react';

type DisclosureProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly className?: string;
  readonly children: ReactNode;
};

export function Disclosure({ open, onOpenChange, className, children }: DisclosureProps) {
  return (
    <details
      className={clsx('group rounded border border-border', className)}
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
    >
      {children}
    </details>
  );
}
