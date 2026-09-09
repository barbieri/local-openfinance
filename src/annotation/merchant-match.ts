const MERCHANT_NOISE =
  /\b(ltda|limitada|sa|s\.a\.|me|epp|pix|pagamento|pagto|compra|debito|credito|transferencia)\b/giu;

export function normalizeMerchantText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(MERCHANT_NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(value.split(' ').filter((token) => token.length > 1));
}

function tokenOverlapScore(left: string, right: string): number {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }

  return (2 * intersection) / (leftTokens.size + rightTokens.size);
}

function containmentScore(left: string, right: string): number {
  if (!left || !right) {
    return 0;
  }
  if (left === right) {
    return 1;
  }
  if (left.includes(right) || right.includes(left)) {
    const shorter = Math.min(left.length, right.length);
    const longer = Math.max(left.length, right.length);
    return shorter / longer;
  }
  return 0;
}

export function resolveMerchantComparableText(
  merchantName: string | null | undefined,
  description: string | null | undefined,
): string {
  const merchant = normalizeMerchantText(merchantName);
  const descriptionText = normalizeMerchantText(description);
  if (merchant && descriptionText) {
    return merchant.length >= descriptionText.length ? merchant : descriptionText;
  }
  return merchant || descriptionText;
}

export function scoreMerchantSimilarity(
  leftMerchant: string | null | undefined,
  leftDescription: string | null | undefined,
  rightMerchant: string | null | undefined,
  rightDescription: string | null | undefined,
): number {
  const left = resolveMerchantComparableText(leftMerchant, leftDescription);
  const right = resolveMerchantComparableText(rightMerchant, rightDescription);
  if (!left || !right) {
    return 0;
  }

  return Math.max(containmentScore(left, right), tokenOverlapScore(left, right));
}
