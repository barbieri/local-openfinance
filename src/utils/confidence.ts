export function resolveConfidencePercent(value: number): number {
  return value > 1 ? Math.round(Math.min(100, value)) : Math.round(value * 100);
}

export function confidenceColor(value: number | null): string {
  if (value === null) {
    return '#64748b';
  }
  return confidenceToneColor(confidenceTone(resolveConfidencePercent(value)));
}

export function confidenceToneColor(tone: 'low' | 'medium' | 'high'): string {
  return { low: '#dc2626', medium: '#ea580c', high: '#16a34a' }[tone];
}

export function confidenceTone(percent: number): 'low' | 'medium' | 'high' {
  return percent < 50 ? 'low' : percent < 75 ? 'medium' : 'high';
}
