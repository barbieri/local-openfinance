import {
  type ContentLocale,
  DEFAULT_CONTENT_LOCALE,
  resolveContentLocale,
} from '../utils/locale-resolve.js';
import mccCodesDocument from './mcc-codes.json' with { type: 'json' };

export type MccLocale = ContentLocale;

type MccEntry = {
  readonly en: string;
  readonly pt: string;
};

const codes = mccCodesDocument.codes as Record<string, MccEntry>;

function normalizeMccCode(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value)).padStart(4, '0').slice(-4);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const digits = value.trim().replace(/\D/g, '');
    if (digits.length === 0) {
      return null;
    }
    return digits.padStart(4, '0').slice(-4);
  }
  return null;
}

function resolveMccLocale(locale: string | undefined): MccLocale {
  return resolveContentLocale(locale);
}

export function resolveMccName(
  mcc: unknown,
  locale: string | undefined = DEFAULT_CONTENT_LOCALE,
): string | null {
  const code = normalizeMccCode(mcc);
  if (!code) {
    return null;
  }
  const entry = codes[code];
  if (!entry) {
    return `MCC ${code}`;
  }
  const lang = resolveMccLocale(locale);
  return entry[lang] ?? entry.en;
}

export function listMccCodes(): Readonly<Record<string, MccEntry>> {
  return codes;
}

export function mccCodesDocumentVersion(): number {
  return mccCodesDocument.version;
}
