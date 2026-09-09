import type { TransferRelatedLeg } from './TransferLinkTooltip.js';

export type TransactionDetailRow = {
  readonly id: string;
  readonly account_id: string;
  readonly local_date: string;
  readonly occurred_at: string;
  readonly display_occurred_at?: string;
  readonly display_name: string;
  readonly description: string | null;
  readonly display_description: string | null;
  readonly merchant_name: string | null;
  readonly amount_cents: number;
  readonly currency: string;
  readonly account_currency: string;
  readonly amount_in_account_currency_cents: number;
  readonly payment_type: string | null;
  readonly status: string | null;
  readonly category_id: string | null;
  readonly category_override_id: string | null;
  readonly category_presentation: {
    readonly name: string;
    readonly icon: string;
    readonly color: string;
    readonly path?: string;
  } | null;
  readonly original_category_presentation: {
    readonly name: string;
    readonly icon: string;
    readonly color: string;
    readonly path?: string;
  } | null;
  readonly installment_number: number | null;
  readonly total_installments: number | null;
  readonly annotation: {
    readonly categoryId: string | null;
    readonly subCategoryId: string | null;
    readonly category: string | null;
    readonly subCategory: string | null;
    readonly labels: readonly string[];
    readonly labelIds: readonly string[];
    readonly labelPresentations?: readonly {
      readonly id: string;
      readonly name: string;
      readonly icon: string;
      readonly color: string;
      readonly path: string;
    }[];
    readonly notes: string | null;
  } | null;
  readonly transfer_group: {
    readonly id: string;
    readonly kind: string;
    readonly related: TransferRelatedLeg | null;
  } | null;
  readonly merchant_detail: {
    readonly business_name: string | null;
    readonly cnpj: string | null;
    readonly cnae: string | null;
    readonly category: string | null;
  } | null;
  readonly credit_card: {
    readonly bill_id: string | null;
    readonly bill_due_date: string | null;
    readonly bill_link_source: string | null;
    readonly bill_link_confidence: number | null;
    readonly purchase_date: string | null;
    readonly purchase_total_cents: number | null;
    readonly payee_mcc: number | null;
    readonly payee_mcc_name: string | null;
    readonly installment_number: number | null;
    readonly total_installments: number | null;
    readonly can_change_bill_link: boolean;
  } | null;
  readonly raw_json: string;
};
