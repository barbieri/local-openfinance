import type { ReactNode } from 'react';
import { MdEdit } from 'react-icons/md';

type EditIconButtonProps = {
  readonly label: string;
  readonly onClick: () => void;
};

export function EditIconButton({ label, onClick }: EditIconButtonProps) {
  return (
    <button
      type="button"
      className="inline-flex items-center justify-center rounded p-1 text-primary hover:bg-accent"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <MdEdit className="size-4" />
    </button>
  );
}

export function ActionIconButton({
  label,
  onClick,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
