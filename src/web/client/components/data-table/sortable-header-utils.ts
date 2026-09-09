import { clsx } from 'clsx';

export function alignClass(align: 'left' | 'right' | 'center' = 'left'): string {
  return clsx(
    align === 'right' && 'text-right',
    align === 'center' && 'text-center',
    align === 'left' && 'text-left',
  );
}

export function contentAlignClass(align: 'left' | 'right' | 'center' = 'left'): string {
  return clsx(
    'flex w-full items-center',
    align === 'right' && 'justify-end',
    align === 'center' && 'justify-center',
    align === 'left' && 'justify-start',
  );
}
