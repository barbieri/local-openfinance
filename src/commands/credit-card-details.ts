import process from 'node:process';
import chalk from 'chalk';
import type { Argv, CommandModule } from 'yargs';
import { loadConfig } from '../config/load-config.js';
import { type EnrichedAccount, listEnrichedCreditCards } from '../db/account-list-details.js';
import { openDatabase } from '../db/connection.js';
import { formatCurrency, formatShortDate } from '../db/terminal-format.js';
import { OpenFinanceClient } from '../openfinance/client.js';
import {
  parseAmountToCents,
  readArray,
  readFieldString,
  readRecord,
} from '../openfinance/money.js';
import { type ConfigArgv, withConfigOption } from './shared.js';

type CreditCardDetailsArgv = ConfigArgv & {
  readonly account: string;
  readonly limit?: number | undefined;
  readonly json?: boolean | undefined;
};

type CreditCardBillPayment = {
  readonly id: string | null;
  readonly paymentDate: string | null;
  readonly amount: string | null;
  readonly valueType: string | null;
  readonly paymentMode: string | null;
};

type CreditCardBillFinanceCharge = {
  readonly id: string | null;
  readonly type: string | null;
  readonly amount: string | null;
};

type CreditCardBillDetail = {
  readonly id: string;
  readonly dueDate: string | null;
  readonly totalAmount: string | null;
  readonly totalAmountCurrencyCode: string;
  readonly minimumPaymentAmount: string | null;
  readonly allowsInstallments: boolean | null;
  readonly payment_status: string | null;
  readonly payments: readonly CreditCardBillPayment[];
  readonly financeCharges: readonly CreditCardBillFinanceCharge[];
};

type CreditCardDetailsJson = {
  readonly account: {
    readonly id: string;
    readonly display_name: string;
    readonly connection_display_name: string | null;
    readonly name: string | null;
    readonly number: string | null;
    readonly subtype: string | null;
    readonly balance_cents: number | null;
    readonly currency: string;
  };
  readonly bills: readonly CreditCardBillDetail[];
};

export const creditCardDetailsCommand: CommandModule<object, CreditCardDetailsArgv> = {
  command: 'credit-card-details <account>',
  describe: 'fetch Banco MCP bill details for a synced credit card account',
  builder: (argv) =>
    withConfigOption(argv)
      .positional('account', {
        type: 'string',
        demandOption: true,
        describe: 'Credit card account id, display-name fragment, card name, or last digits',
      })
      .option('limit', {
        type: 'number',
        default: 12,
        describe: 'Maximum number of recent bills to fetch',
      })
      .option('json', {
        type: 'boolean',
        default: false,
        describe: 'Print bare bill detail fields as JSON',
      }) as Argv<CreditCardDetailsArgv>,
  handler: async (argv) => {
    const resolved = await loadConfig(argv.config);
    const { db } = openDatabase(resolved);
    const { creditCards } = listEnrichedCreditCards(db, { limit: 10_000, offset: 0 });
    const account = resolveCreditCardAccount(creditCards, argv.account);
    const client = new OpenFinanceClient();
    const bills = await fetchCreditCardBillDetails(client, account.id, argv.limit ?? 12);
    const output = buildCreditCardDetailsJson(account, bills);

    if (argv.json) {
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
      return;
    }

    process.stdout.write(renderCreditCardDetails(output));
  },
};

function resolveCreditCardAccount(
  creditCards: readonly EnrichedAccount[],
  selector: string,
): EnrichedAccount {
  const normalized = selector.trim().toLowerCase();
  const exact = creditCards.find((card) => card.id === selector);
  if (exact) {
    return exact;
  }

  const matches = creditCards.filter((card) => {
    const values = [
      card.display_name,
      card.name,
      card.number,
      card.account_group_label,
      card.connection_display_name,
    ];
    return values.some((value) => value?.toLowerCase().includes(normalized));
  });

  if (matches.length === 1) {
    return matches[0] as EnrichedAccount;
  }

  if (matches.length > 1) {
    const options = matches.map((card) => `- ${card.display_name} (${card.id})`).join('\n');
    throw new Error(`Credit card selector matched multiple accounts:\n${options}`);
  }

  throw new Error(`No synced credit card matched selector: ${selector}`);
}

async function fetchCreditCardBillDetails(
  client: OpenFinanceClient,
  accountId: string,
  limit: number,
): Promise<CreditCardBillDetail[]> {
  const pageSize = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const listResult = await client.post<Record<string, unknown>>('/credit-card-bills/list', {
    account_id: accountId,
    page: 1,
    page_size: pageSize,
  });
  const listRows = rowsFromPagedResult(listResult).slice(0, pageSize);
  const listRowsById = new Map(
    listRows
      .map((row) => [readFieldString(row, 'id'), row] as const)
      .filter((entry): entry is readonly [string, Record<string, unknown>] => entry[0] !== null),
  );
  const billIds = [...listRowsById.keys()];
  const detailResults = await Promise.all(
    chunk(billIds, 50).map((batch) =>
      client.post<Record<string, unknown>>('/credit-card-bills/detail', {
        bill_ids: batch,
      }),
    ),
  );
  const details = detailResults.flatMap((detailResult) =>
    rowsFromPagedResult(detailResult).flatMap((detailRow) => {
      const detail = parseBillDetail(detailRow, listRowsById);
      return detail ? [detail] : [];
    }),
  );

  return details.toSorted((a, b) => String(b.dueDate ?? '').localeCompare(String(a.dueDate ?? '')));
}

function rowsFromPagedResult(result: Record<string, unknown>): Record<string, unknown>[] {
  for (const key of ['results', 'items', 'rows', 'data', 'bills']) {
    const value = result[key];
    if (Array.isArray(value)) {
      return value.flatMap((item) => {
        const record = readRecord(item);
        return record ? [record] : [];
      });
    }
  }
  return [];
}

function parseBillDetail(
  detailRow: Record<string, unknown>,
  listRowsById: ReadonlyMap<string, Record<string, unknown>>,
): CreditCardBillDetail | null {
  const bill = readRecord(detailRow['bill']);
  const billId =
    readFieldString(detailRow, 'bill_id') ?? (bill ? readFieldString(bill, 'id') : null);
  if (!bill || !billId) {
    return null;
  }

  const listRow = listRowsById.get(billId);
  return {
    id: billId,
    dueDate: readFieldString(bill, 'dueDate'),
    totalAmount: readFieldString(bill, 'totalAmount'),
    totalAmountCurrencyCode: readFieldString(bill, 'totalAmountCurrencyCode') ?? 'BRL',
    minimumPaymentAmount: readFieldString(bill, 'minimumPaymentAmount'),
    allowsInstallments:
      typeof bill['allowsInstallments'] === 'boolean' ? bill['allowsInstallments'] : null,
    payment_status: listRow ? readFieldString(listRow, 'payment_status') : null,
    payments: readArray(bill['payments']).map(parsePayment),
    financeCharges: readArray(bill['financeCharges']).map(parseFinanceCharge),
  };
}

function parsePayment(value: unknown): CreditCardBillPayment {
  const record = readRecord(value) ?? {};
  return {
    id: readFieldString(record, 'id'),
    paymentDate: readFieldString(record, 'paymentDate'),
    amount: readFieldString(record, 'amount'),
    valueType: readFieldString(record, 'valueType'),
    paymentMode: readFieldString(record, 'paymentMode'),
  };
}

function parseFinanceCharge(value: unknown): CreditCardBillFinanceCharge {
  const record = readRecord(value) ?? {};
  return {
    id: readFieldString(record, 'id'),
    type: readFieldString(record, 'type'),
    amount: readFieldString(record, 'amount'),
  };
}

function buildCreditCardDetailsJson(
  account: EnrichedAccount,
  bills: readonly CreditCardBillDetail[],
): CreditCardDetailsJson {
  return {
    account: {
      id: account.id,
      display_name: account.display_name,
      connection_display_name: account.connection_display_name,
      name: account.name,
      number: account.number,
      subtype: account.subtype,
      balance_cents: account.balance_cents,
      currency: account.currency,
    },
    bills,
  };
}

function renderCreditCardDetails(details: CreditCardDetailsJson): string {
  const lines = [
    `${chalk.bold(details.account.display_name)} ${chalk.dim(`(${details.account.id})`)}`,
  ];
  if (details.account.connection_display_name) {
    lines.push(chalk.dim(`Connection: ${details.account.connection_display_name}`));
  }
  lines.push('');

  if (details.bills.length === 0) {
    lines.push(chalk.dim('No credit card bills returned by Banco MCP.'));
    return `${lines.join('\n')}\n`;
  }

  for (const bill of details.bills) {
    lines.push(formatBillLine(bill));
    lines.push(formatPaymentsLine(bill));
    lines.push(formatFinanceChargesLine(bill));
    lines.push('');
  }

  return `${lines.join('\n')}`;
}

function formatBillLine(bill: CreditCardBillDetail): string {
  const currency = bill.totalAmountCurrencyCode;
  const total = formatApiAmount(bill.totalAmount, currency);
  const minimum = formatApiAmount(bill.minimumPaymentAmount, currency);
  const dueDate = bill.dueDate ? formatShortDate(bill.dueDate) : 'No due date';
  const status = bill.payment_status ?? 'UNKNOWN';
  const installments = bill.allowsInstallments === true ? 'allows installments' : 'no installments';
  return `${chalk.yellow(dueDate)}  ${chalk.bold(total)}  min ${minimum}  ${status}  ${chalk.dim(installments)}`;
}

function formatPaymentsLine(bill: CreditCardBillDetail): string {
  if (bill.payments.length === 0) {
    return chalk.dim('  payments: none');
  }

  const payments = bill.payments.map((payment) => {
    const amount = formatApiAmount(payment.amount, bill.totalAmountCurrencyCode);
    const date = payment.paymentDate ? formatShortDate(payment.paymentDate) : 'no date';
    const mode = payment.paymentMode ?? 'payment';
    return `${date} ${amount} ${mode}`;
  });
  return `  payments: ${payments.join('; ')}`;
}

function formatFinanceChargesLine(bill: CreditCardBillDetail): string {
  if (bill.financeCharges.length === 0) {
    return chalk.dim('  finance charges: none');
  }

  const charges = bill.financeCharges.map((charge) => {
    const amount = formatApiAmount(charge.amount, bill.totalAmountCurrencyCode);
    return `${charge.type ?? 'charge'} ${amount}`;
  });
  return `  finance charges: ${charges.join('; ')}`;
}

function formatApiAmount(value: string | null, currency: string): string {
  const cents = parseAmountToCents(value);
  if (cents === null) {
    return value ?? 'n/a';
  }
  return formatCurrency(cents, currency);
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}
