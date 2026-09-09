import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export function DisclosureContent({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return <div className={clsx('border-t border-border p-3 pt-2', className)}>{children}</div>;
}
