import { createHash } from 'node:crypto';

export function hashFeatureText(featureText: string): string {
  return createHash('sha256').update(featureText).digest('hex');
}
