import chalk from 'chalk';
import { getNumberFormat } from '../../utils/intl-formatters.js';
import {
  type EnrichedInvestment,
  formatInvestmentIssuerLabel,
  formatInvestmentRateLabel,
  type InvestmentGroupByField,
} from '../investment-details.js';

type InvestmentGroup = {
  readonly key: string;
  readonly label: string;
  readonly children: Map<string, InvestmentGroup>;
  readonly items: EnrichedInvestment[];
};

export function renderInvestmentsTree(
  investments: readonly EnrichedInvestment[],
  groupBy: readonly InvestmentGroupByField[],
): string {
  if (investments.length === 0) {
    return chalk.dim('No investments matched the current filters.');
  }

  const root = buildInvestmentGroup(investments, groupBy, 0);
  const lines: string[] = [];
  renderInvestmentGroup(root, groupBy, 0, lines);
  return `${lines.join('\n')}\n`;
}

function buildInvestmentGroup(
  investments: readonly EnrichedInvestment[],
  groupBy: readonly InvestmentGroupByField[],
  depth: number,
): InvestmentGroup {
  if (depth >= groupBy.length) {
    return {
      key: 'leaf',
      label: 'leaf',
      children: new Map(),
      items: [...investments],
    };
  }

  const field = groupBy[depth] as InvestmentGroupByField;
  const buckets = new Map<
    string,
    { readonly key: string; readonly label: string; readonly items: EnrichedInvestment[] }
  >();

  for (const investment of investments) {
    const { key, label } = resolveInvestmentGroupKey(investment, field);
    const existing = buckets.get(key);
    buckets.set(key, {
      key,
      label,
      items: existing ? [...existing.items, investment] : [investment],
    });
  }

  const children = new Map<string, InvestmentGroup>();
  for (const bucket of buckets.values()) {
    const nested = buildInvestmentGroup(bucket.items, groupBy, depth + 1);
    children.set(bucket.key, {
      key: bucket.key,
      label: bucket.label,
      children: nested.children,
      items: nested.items,
    });
  }

  return {
    key: 'root',
    label: 'root',
    children,
    items: [],
  };
}

function renderInvestmentGroup(
  group: InvestmentGroup,
  groupBy: readonly InvestmentGroupByField[],
  depth: number,
  lines: string[],
): void {
  if (depth >= groupBy.length) {
    const nameWidth = Math.max(8, ...group.items.map((item) => formatInvestmentLabel(item).length));

    for (const item of group.items) {
      lines.push(`${' '.repeat(depth * 2)}${formatInvestmentLine(item, nameWidth)}`);
    }
    return;
  }

  const field = groupBy[depth] as InvestmentGroupByField;
  const sortedChildren = [...group.children.values()];
  sortedChildren.sort((left, right) => left.label.localeCompare(right.label));

  for (const child of sortedChildren) {
    if (field !== 'name') {
      lines.push(`${' '.repeat(depth * 2)}${formatGroupHeading(depth, child.label)}`);
    }
    renderInvestmentGroup(child, groupBy, depth + 1, lines);
  }
}

function formatGroupHeading(depth: number, label: string): string {
  if (depth === 0) {
    return chalk.bold(label);
  }

  return chalk.cyan(label);
}

function resolveInvestmentGroupKey(
  investment: EnrichedInvestment,
  field: InvestmentGroupByField,
): { readonly key: string; readonly label: string } {
  switch (field) {
    case 'account':
      return {
        key: investment.account_group_key,
        label: investment.account_group_label,
      };
    case 'type':
      return {
        key: investment.type ?? 'UNKNOWN',
        label: investment.type ?? 'UNKNOWN',
      };
    case 'subtype':
      return {
        key: investment.subtype ?? 'UNKNOWN',
        label: investment.subtype ?? 'UNKNOWN',
      };
    case 'name':
      return {
        key: investment.display_name,
        label: investment.display_name,
      };
    default:
      return { key: 'UNKNOWN', label: 'UNKNOWN' };
  }
}

function formatInvestmentLabel(investment: EnrichedInvestment): string {
  return investment.code ?? investment.display_name;
}

function formatInvestmentLine(investment: EnrichedInvestment, nameWidth: number): string {
  if (investment.type === 'FIXED_INCOME') {
    return formatFixedIncomeLine(investment, nameWidth);
  }

  if (investment.quantity !== null && investment.quantity > 0) {
    return formatQuantityLine(investment, nameWidth);
  }

  return formatSimpleLine(investment, nameWidth);
}

function formatFixedIncomeLine(investment: EnrichedInvestment, nameWidth: number): string {
  const label = formatInvestmentLabel(investment).padEnd(nameWidth, ' ');
  const total = formatCurrency(investment.total_cents, investment.currency);
  const metaParts: string[] = [];

  if (investment.purchase_date) {
    metaParts.push(formatShortDate(investment.purchase_date));
  }

  if (investment.taxes_cents !== null && investment.taxes_cents > 0) {
    metaParts.push(`taxes: ${formatPlainAmount(investment.taxes_cents)}`);
  }

  const meta = metaParts.length > 0 ? chalk.dim(` (${metaParts.join(', ')})`) : '';
  const status = formatStatusSuffix(investment.status);

  return `${chalk.white(label)}  ${chalk.green(total)}${meta}${status}`;
}

function formatQuantityLine(investment: EnrichedInvestment, nameWidth: number): string {
  const label = formatInvestmentLabel(investment).padEnd(nameWidth, ' ');
  const pricing = resolveEquityPricing(investment);
  const quantity = formatDecimal(pricing.quantity ?? 0);
  const unitPrice = formatCurrency(pricing.unitPriceCents, investment.currency);
  const total = formatCurrency(pricing.totalCents, investment.currency);
  const status = formatStatusSuffix(investment.status);

  return `${chalk.white(label)}  ${quantity} x ${unitPrice} = ${chalk.green(total)}${status}`;
}

function formatSimpleLine(investment: EnrichedInvestment, nameWidth: number): string {
  const label = formatInvestmentLabel(investment).padEnd(nameWidth, ' ');
  const totalCents = investment.total_cents ?? investment.unit_price_cents;
  const value =
    totalCents !== null
      ? chalk.green(formatCurrency(totalCents, investment.currency))
      : chalk.dim('n/a');
  const status = formatStatusSuffix(investment.status);

  return `${chalk.white(label)}  ${value}${status}`;
}

function resolveEquityPricing(investment: EnrichedInvestment): {
  readonly quantity: number | null;
  readonly unitPriceCents: number | null;
  readonly totalCents: number | null;
} {
  const quantity = investment.quantity;
  let unitPriceCents = investment.unit_price_cents;
  let totalCents = investment.total_cents;

  if (unitPriceCents === null && totalCents !== null && quantity !== null && quantity > 0) {
    unitPriceCents = Math.round(totalCents / quantity);
  }

  if (totalCents === null && unitPriceCents !== null && quantity !== null && quantity > 0) {
    totalCents = Math.round(unitPriceCents * quantity);
  }

  return { quantity, unitPriceCents, totalCents };
}

function formatStatusSuffix(status: string | null): string {
  if (!status || status === 'ACTIVE') {
    return '';
  }

  return chalk.yellow(` [${status}]`);
}

function formatShortDate(value: string): string {
  if (value.length >= 10) {
    return value.slice(0, 10);
  }

  return value;
}

const ptBrDecimalFormat = getNumberFormat('pt-BR', { maximumFractionDigits: 4 });
const ptBrPlainAmountFormat = getNumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatCurrency(amountCents: number | null, currency: string): string {
  if (amountCents === null) {
    return 'n/a';
  }

  return getNumberFormat('pt-BR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountCents / 100);
}

function formatDecimal(value: number): string {
  return ptBrDecimalFormat.format(value);
}

function formatPlainAmount(amountCents: number): string {
  return ptBrPlainAmountFormat.format(amountCents / 100);
}

export function serializeInvestmentForJson(
  investment: EnrichedInvestment,
): Record<string, unknown> {
  const rawRecord = JSON.parse(investment.raw_json) as Record<string, unknown>;

  return {
    db: {
      id: investment.id,
      connection_item_id: investment.connection_item_id,
      connector_name: investment.connector_name,
      type: investment.type,
      subtype: investment.subtype,
      name: investment.name,
      code: investment.code,
      balance_cents: investment.balance_cents,
      currency: investment.currency,
      synced_at: investment.synced_at,
    },
    parsed: {
      display_name: investment.display_name,
      connection_display_name: investment.connection_display_name,
      account_group_label: investment.account_group_label,
      isin: investment.isin,
      status: investment.status,
      unit_price_cents: investment.unit_price_cents,
      total_cents: investment.total_cents,
      quantity: investment.quantity,
      amount_cents: investment.amount_cents,
      amount_withdrawal_cents: investment.amount_withdrawal_cents,
      issuer: investment.issuer,
      issuer_cnpj: investment.issuer_cnpj,
      issuer_label: formatInvestmentIssuerLabel(investment.issuer, investment.issuer_cnpj),
      rate: investment.rate,
      rate_type: investment.rate_type,
      rate_label: formatInvestmentRateLabel(investment.rate, investment.rate_type),
      purchase_date: investment.purchase_date,
      due_date: investment.due_date,
      taxes_cents: investment.taxes_cents,
      taxes2_cents: investment.taxes2_cents,
    },
    raw_json: rawRecord,
  };
}
