import { parse, pt } from 'chrono-node';

const portugueseMonthFormatter = new Intl.DateTimeFormat('pt-BR', {
  month: 'long',
  timeZone: 'UTC',
});
const portugueseMonthNames = new Set(
  Array.from({ length: 12 }, (_, month) =>
    portugueseMonthFormatter.format(new Date(Date.UTC(2000, month, 1))).toLocaleLowerCase('pt-BR'),
  ),
);

function isCompleteDate(result: ReturnType<typeof parse>[number]): boolean {
  if ([...result.start.tags()].some((tag) => tag.startsWith('casualReference/'))) {
    return false;
  }
  const hasDayAndMonth = result.start.isCertain('day') && result.start.isCertain('month');
  const hasMonthAndYear = result.start.isCertain('month') && result.start.isCertain('year');
  return hasDayAndMonth || hasMonthAndYear;
}

function containsLocalizedYearMonth(value: string): boolean {
  const tokens = value.toLocaleLowerCase('pt-BR').match(/[\p{L}]+|\d{4}/gu) ?? [];
  return tokens.some(
    (token, index) =>
      /^\d{4}$/u.test(token) &&
      (portugueseMonthNames.has(tokens[index - 1] ?? '') ||
        portugueseMonthNames.has(tokens[index + 1] ?? '')),
  );
}

export function containsReportDateInProse(value: string): boolean {
  return (
    [...parse(value), ...pt.parse(value)].some(isCompleteDate) || containsLocalizedYearMonth(value)
  );
}
