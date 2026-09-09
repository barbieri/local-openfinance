import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { MdArrowDownward, MdArrowUpward, MdUnfoldMore } from 'react-icons/md';
import { contentAlignClass } from './sortable-header-utils.js';

export function SortableHeader({
  label,
  align = 'left',
  sorted,
}: {
  readonly label: ReactNode;
  readonly align?: 'left' | 'right' | 'center';
  readonly sorted: false | 'asc' | 'desc';
}) {
  const Icon =
    sorted === 'asc' ? MdArrowUpward : sorted === 'desc' ? MdArrowDownward : MdUnfoldMore;

  return (
    <span className={clsx(contentAlignClass(align), 'gap-1')}>
      <span>{label}</span>
      <Icon
        className={clsx('size-3.5 shrink-0', sorted ? 'text-primary' : 'text-muted-foreground/60')}
        aria-hidden
      />
    </span>
  );
}
