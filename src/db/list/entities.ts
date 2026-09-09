import { VISIBLE_ACCOUNT_TRANSACTIONS_WHERE, VISIBLE_ACCOUNTS_WHERE } from '../account-links.js';
import type { ListEntityDefinition } from './types.js';

export const connectionsEntity: ListEntityDefinition = {
  name: 'connections',
  table: 'connections',
  fields: {
    item_id: { type: 'text' },
    connector_id: { type: 'text' },
    connector_name: { type: 'text' },
    status: { type: 'text' },
    synced_at: { type: 'date' },
  },
  defaultOrderBy: 'connector_name ASC, item_id ASC',
};

export const accountsEntity: ListEntityDefinition = {
  name: 'accounts',
  table: 'accounts',
  fields: {
    id: { type: 'text' },
    connection_item_id: { type: 'text' },
    type: { type: 'text' },
    subtype: { type: 'text' },
    name: { type: 'text' },
    number: { type: 'text' },
    owner: { type: 'text' },
    balance_cents: { type: 'integer' },
    currency: { type: 'text' },
    credit_brand: { type: 'text' },
    credit_level: { type: 'text' },
    synced_at: { type: 'date' },
  },
  defaultOrderBy: 'name ASC, id ASC',
  staticWhere: VISIBLE_ACCOUNTS_WHERE,
};

export const creditCardsEntity: ListEntityDefinition = {
  name: 'credit-cards',
  table: 'accounts',
  fields: accountsEntity.fields,
  defaultOrderBy: 'name ASC, id ASC',
  staticWhere: `type = 'CREDIT' AND ${VISIBLE_ACCOUNTS_WHERE}`,
};

export const transactionsEntity: ListEntityDefinition = {
  name: 'transactions',
  table: 'transactions',
  fields: {
    id: { type: 'text' },
    account_id: { type: 'text' },
    occurred_at: { type: 'date' },
    amount_cents: { type: 'integer' },
    currency: { type: 'text' },
    description: { type: 'text' },
    category_id: { type: 'text' },
    merchant_name: { type: 'text' },
    payment_type: { type: 'text' },
    status: { type: 'text' },
    synced_at: { type: 'date' },
  },
  defaultOrderBy: 'occurred_at DESC, id ASC',
  staticWhere: VISIBLE_ACCOUNT_TRANSACTIONS_WHERE,
};

export const creditCardBillsEntity: ListEntityDefinition = {
  name: 'credit-card-bills',
  table: 'credit_card_bills',
  fields: {
    id: { type: 'text' },
    account_id: { type: 'text' },
    due_date: { type: 'date' },
    total_amount_cents: { type: 'integer' },
    minimum_payment_cents: { type: 'integer' },
    payment_status: { type: 'text' },
    currency: { type: 'text' },
    synced_at: { type: 'date' },
  },
  defaultOrderBy: 'due_date DESC, id ASC',
  staticWhere: VISIBLE_ACCOUNT_TRANSACTIONS_WHERE,
};

export const investmentsEntity: ListEntityDefinition = {
  name: 'investments',
  table: 'investments',
  fields: {
    id: { type: 'text' },
    connection_item_id: { type: 'text' },
    type: { type: 'text' },
    subtype: { type: 'text' },
    name: { type: 'text' },
    code: { type: 'text' },
    balance_cents: { type: 'integer' },
    currency: { type: 'text' },
    status: { type: 'text' },
    issuer: { type: 'text' },
    rate_type: { type: 'text' },
    synced_at: { type: 'date' },
  },
  defaultOrderBy: 'name ASC, id ASC',
};

export const investmentTransactionsEntity: ListEntityDefinition = {
  name: 'investment-transactions',
  table: 'investment_transactions',
  fields: {
    id: { type: 'text' },
    investment_id: { type: 'text' },
    occurred_at: { type: 'date' },
    type: { type: 'text' },
    amount_cents: { type: 'integer' },
    quantity: { type: 'number' },
    currency: { type: 'text' },
    synced_at: { type: 'date' },
  },
  defaultOrderBy: 'occurred_at DESC, id ASC',
};

export const loansEntity: ListEntityDefinition = {
  name: 'loans',
  table: 'loans',
  fields: {
    id: { type: 'text' },
    connection_item_id: { type: 'text' },
    type: { type: 'text' },
    contract_amount_cents: { type: 'integer' },
    due_date: { type: 'date' },
    contract_number: { type: 'text' },
    outstanding_balance_cents: { type: 'integer' },
    currency: { type: 'text' },
    synced_at: { type: 'date' },
  },
  defaultOrderBy: 'due_date DESC, id ASC',
};

export const categoriesEntity: ListEntityDefinition = {
  name: 'categories',
  table: 'categories',
  fields: {
    id: { type: 'text' },
    name: { type: 'text' },
    name_translated: { type: 'text' },
    parent_id: { type: 'text' },
    parent_name: { type: 'text' },
    synced_at: { type: 'date' },
  },
  defaultOrderBy: 'name ASC, id ASC',
};

export const transferGroupsEntity: ListEntityDefinition = {
  name: 'transfer-groups',
  table: 'transfer_groups',
  fields: {
    id: { type: 'text' },
    kind: { type: 'text' },
    confidence: { type: 'number' },
    notes: { type: 'text' },
    created_at: { type: 'date' },
  },
  defaultOrderBy: 'created_at DESC, id ASC',
};
