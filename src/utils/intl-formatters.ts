function optionsKey(options: object): string {
  return JSON.stringify(options);
}

const dateTimeFormatCache = new Map<string, Intl.DateTimeFormat>();

export function getDateTimeFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale}\0${optionsKey(options)}`;
  const cached = dateTimeFormatCache.get(key);
  if (cached) {
    return cached;
  }
  const formatter = Reflect.construct(Intl.DateTimeFormat, [locale, options]);
  dateTimeFormatCache.set(key, formatter);
  return formatter;
}

const numberFormatCache = new Map<string, Intl.NumberFormat>();

export function getNumberFormat(
  locale: string,
  options: Intl.NumberFormatOptions = {},
): Intl.NumberFormat {
  const key = `${locale}\0${optionsKey(options)}`;
  const cached = numberFormatCache.get(key);
  if (cached) {
    return cached;
  }
  const formatter = Reflect.construct(Intl.NumberFormat, [locale, options]);
  numberFormatCache.set(key, formatter);
  return formatter;
}

const relativeTimeFormatCache = new Map<string, Intl.RelativeTimeFormat>();

export function getRelativeTimeFormat(
  locale: string,
  options: Intl.RelativeTimeFormatOptions = {},
): Intl.RelativeTimeFormat {
  const key = `${locale}\0${optionsKey(options)}`;
  const cached = relativeTimeFormatCache.get(key);
  if (cached) {
    return cached;
  }
  const formatter = Reflect.construct(Intl.RelativeTimeFormat, [locale, options]);
  relativeTimeFormatCache.set(key, formatter);
  return formatter;
}
