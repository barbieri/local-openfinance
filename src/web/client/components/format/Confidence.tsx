import { clsx } from 'clsx';
import { confidenceTone, resolveConfidencePercent } from '../../../../utils/confidence.js';

function confidenceToneClass(percent: number): string {
  return {
    low: 'text-red-600',
    medium: 'text-orange-600',
    high: 'text-green-600',
  }[confidenceTone(percent)];
}

export function Confidence({
  value,
  className,
}: {
  readonly value: number;
  readonly className?: string;
}) {
  const percent = resolveConfidencePercent(value);

  return (
    <span className={clsx('tabular-nums font-medium', confidenceToneClass(percent), className)}>
      {percent}%
    </span>
  );
}
