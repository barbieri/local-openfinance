export function formatInvestmentRateLabel(
  rate: number | null | undefined,
  rateType: string | null | undefined,
): string | null {
  const parts: string[] = [];
  if (rate !== null && rate !== undefined) {
    parts.push(`${formatInvestmentRateNumber(rate)}%`);
  }
  if (rateType) {
    parts.push(rateType);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

export function formatInvestmentIssuerLabel(
  issuer: string | null | undefined,
  issuerCnpj: string | null | undefined,
): string | null {
  const formattedCnpj = issuerCnpj ? formatIssuerCnpj(issuerCnpj) : null;
  if (issuer && formattedCnpj) {
    return `${issuer} (${formattedCnpj})`;
  }
  return issuer ?? formattedCnpj;
}

import { getNumberFormat } from '../utils/intl-formatters.js';

const investmentRateNumberFormat = getNumberFormat('en-US', {
  useGrouping: true,
  maximumFractionDigits: 4,
});

function formatInvestmentRateNumber(rate: number): string {
  return investmentRateNumberFormat.format(rate);
}

function formatIssuerCnpj(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 14) {
    return value;
  }
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
}
