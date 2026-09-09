---
name: banco-mcp
description: access to Banco MCP REST API to fetch OpenFinance bank data
---
# Banco MCP — API Skill

You have access to the **Banco MCP** REST API on MCP.AI.

> Aggregates bank data (balances, bills and statements) via Brazil's Open Finance. Each institution becomes a connection; multiple banks per user are stored in credentials.connections[]. Read-only.

## Base URL

```
https://api.mcp.ai/api/openfinance
```

Every endpoint is a `POST` to the base URL + the endpoint path below. All parameters go in the JSON body. Action-style endpoints take a required `action` field that selects the operation.

## Authentication

Include in every request:

```
Authorization: Bearer sk_live_...
Content-Type: application/json
```

## Response format

```json
{ "ok": true, "tool": "<tool_id>", "result": <payload> }
```

## cURL example

```bash
curl -X POST https://api.mcp.ai/api/openfinance/connectors/search \
  -H "Authorization: Bearer sk_live_..." \
  -H "Content-Type: application/json" \
  -d '{"keywords":["btg","nubank"]}'
```

## Discovering endpoints

This API self-documents. For the always-current version of this documentation, no auth required:

- Structured JSON (all endpoints + parameters + examples): `GET https://api.mcp.ai/api/openfinance/_endpoints`
- OpenAPI 3.1 spec (Swagger / Insomnia / Postman import): `GET https://api.mcp.ai/api/openfinance/_openapi`
- This skill in markdown: `GET https://api.mcp.ai/api/openfinance/_skill.md`

Use these when learning a new MCP, refreshing a stale catalog, or integrating from a fresh agent context.

## Reporting problems

If any endpoint returns an error, empty or unexpected data, or you suspect a platform bug, report it instead of silently giving up. This notifies the MCP.AI team so they can look into it.

#### `report_bug`

Report a problem, empty or unexpected data, or a suspected platform bug to the MCP.AI team _(POST https://api.mcp.ai/api/openfinance/report)_

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message` | string | Yes | What went wrong or what you expected to happen |
| `context` | string | No | Endpoint that failed, error message, or what you were trying to do |
| `conversation` | array | No | Recent messages for reproduction. Array of { role, content, tool_name? } |

**Request body:**
```json
{
  "message": "investments/list returned empty for one of my connections",
  "context": "POST /api/openfinance/investments/list with item=...",
  "conversation": []
}
```

**Response example:**
```json
{
  "ok": true,
  "tool": "report_bug",
  "result": {
    "report_id": "bug_...",
    "message": "Report received (bug_...). The MCP.AI team has been notified. Thank you!"
  }
}
```

## Available endpoints (16)

### Connections

#### `openfinance_search_bank_connectors`

Search bank connectors (Open Finance/API) by name _(POST https://api.mcp.ai/api/openfinance/connectors/search)_

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `keywords` | string[] | Yes | Bank name/id terms (OR match), e.g. ['nubank','btg']. Required. |
| `include_accounts` | boolean | No | Include accounts (+ count) of each already-linked connection. One call per connection; default false. |

**Request body:**
```json
{
  "keywords": [
    "btg",
    "nubank"
  ]
}
```

**Response example:**
```json
{
  "ok": true,
  "tool": "openfinance_search_bank_connectors",
  "result": {
    "banks": [
      {
        "id": "675",
        "name": "BTGPactual",
        "access": "open_finance",
        "type": "PERSONAL_BANK",
        "audience": "pf",
        "connect_url": "https://app.mcp.ai/connect/mi_…?u=usr_…&flow=quick&field_bank_id=675"
      }
    ],
    "connect_url_base": "https://app.mcp.ai/connect/mi_…?u=usr_…&flow=quick",
    "totals": {
      "matched": 1,
      "connected_connections": 0,
      "connected_accounts": 0
    }
  }
}
```

#### `openfinance_list_connections`

List connected banks _(POST https://api.mcp.ai/api/openfinance/connections/list)_

**Response example:**
```json
{
  "ok": true,
  "tool": "openfinance_list_connections",
  "result": {
    "connections": [
      {
        "connector_id": "612",
        "connector_name": "Nubank",
        "item_id": "uuid-aaa",
        "status": "UPDATED"
      }
    ],
    "count": 1,
    "add_connection_url": "https://app.mcp.ai/connect/mi_…?u=usr_…&add=1"
  }
}
```

#### `openfinance_get_item_status`

Status of a connection (UPDATED, LOGIN_ERROR…) _(POST https://api.mcp.ai/api/openfinance/connections/status)_

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `item` | string | No | item_id (uuid), connector_id ('612'), or connector_name ('Nubank'). Omit when only 1 connection. |

**Request body:**
```json
{
  "item": "612"
}
```


#### `openfinance_force_sync`

Force-sync one or more connections _(POST https://api.mcp.ai/api/openfinance/connections/sync)_

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `items` | string[] | Yes | Connection selectors (item_id, connector_id, or connector_name). 1-50. |

**Request body:**
```json
{
  "items": [
    "612",
    "Itaú"
  ]
}
```


#### `openfinance_disconnect_bank`

Revoke Open Finance consent for a bank _(POST https://api.mcp.ai/api/openfinance/connections/disconnect)_

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `item` | string | Yes | item_id (uuid), connector_id, or connector_name of the connection. |

**Request body:**
```json
{
  "item": "Nubank"
}
```


### Accounts

#### `openfinance_list_accounts`

List accounts (BANK / CREDIT) of a connection _(POST https://api.mcp.ai/api/openfinance/accounts/list)_

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `item` | string | No | Target connection. |
| `type` | string | No | Filter by type. (BANK, CREDIT) |

CREDIT account rows include `creditData` with card brand/level/limits and, when the institution exposes them, `balanceCloseDate` (statement closing date) and `balanceDueDate` (payment due date).

**Request body:**
```json
{
  "item": "612",
  "type": "BANK"
}
```


#### `openfinance_get_accounts_detail`

Full account detail by id (batch 1-50) _(POST https://api.mcp.ai/api/openfinance/accounts/detail)_

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `account_ids` | string[] | Yes | Account uuids. 1-50. |

**Request body:**
```json
{
  "account_ids": [
    "uuid-a",
    "uuid-b"
  ]
}
```


#### `openfinance_get_account_balance`

Real-time balance per account (batch 1-50) _(POST https://api.mcp.ai/api/openfinance/accounts/balance)_

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `account_ids` | string[] | Yes | Account uuids. 1-50. |

**Request body:**
```json
{
  "account_ids": [
    "uuid-a",
    "uuid-b"
  ]
}
```


### Transactions

#### `openfinance_list_transactions`

Transactions per account (BANK or CREDIT) with date/keyword filters _(POST https://api.mcp.ai/api/openfinance/transactions/list)_

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `account_id` | string | Yes | Account uuid. |
| `from` | string | No | Start date ISO (YYYY-MM-DD). |
| `to` | string | No | End date ISO (YYYY-MM-DD). |
| `page` | number | No | Page (default 1). |
| `page_size` | number | No | Items per page (1-500, default 50). |
| `search_queries` | string[] | No | Keyword filter (OR). Triggers aggregated scan in from/to. |
| `detail` | string | No | Response shape: omit for compact (default), `rich` for bill/merchant metadata (`billId`, `purchaseDate`, `payeeMCC`, merchant CNPJ/CNAE, …), or `raw` for the full upstream Open Finance object. Coverage varies by institution. |

**Request body:**
```json
{
  "account_id": "uuid-a",
  "from": "2026-04-01",
  "to": "2026-04-30",
  "detail": "rich",
  "search_queries": [
    "uber",
    "ifood"
  ]
}
```


#### `openfinance_update_transaction_category`

Fix transaction categories (auto-creates a rule) _(POST https://api.mcp.ai/api/openfinance/transactions/category)_

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `items` | object[] | Yes | { transaction_id, category_id } pairs. 1-50. category_id comes from /categories/list. |

**Request body:**
```json
{
  "items": [
    {
      "transaction_id": "uuid-tx-1",
      "category_id": "05080000"
    }
  ]
}
```

**Response example:**
```json
{
  "ok": true,
  "tool": "openfinance_update_transaction_category",
  "result": {
    "updated": 1,
    "results": [
      {
        "transaction_id": "uuid-tx-1",
        "category": "Food and drink",
        "categoryId": "05080000"
      }
    ],
    "errors": []
  }
}
```

### Credit_cards

#### `openfinance_list_credit_card_bills`

Credit card bills (with derived payment_status) _(POST https://api.mcp.ai/api/openfinance/credit-card-bills/list)_

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `account_id` | string | Yes | CREDIT account uuid. |
| `page` | number | No |  |
| `page_size` | number | No | 1-100. |

**Request body:**
```json
{
  "account_id": "uuid-credit"
}
```


#### `openfinance_get_credit_card_bill`

Bill detail by id (batch 1-50) _(POST https://api.mcp.ai/api/openfinance/credit-card-bills/detail)_

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `bill_ids` | string[] | Yes | Bill uuids. 1-50. |

**Request body:**
```json
{
  "bill_ids": [
    "uuid-bill-1"
  ]
}
```


### Investments

#### `openfinance_list_investments`

Investment portfolio per connection _(POST https://api.mcp.ai/api/openfinance/investments/list)_

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `item` | string | No |  |
| `type` | string | No | Filter by type. (COE, EQUITY, ETF, FIXED_INCOME, MUTUAL_FUND, SECURITY, OTHER) |
| `page` | number | No |  |
| `page_size` | number | No | 1-500, default 100. |

**Request body:**
```json
{
  "item": "612",
  "type": "FIXED_INCOME"
}
```


#### `openfinance_list_investment_transactions`

Movement history of an investment position (BUY/SELL/TAX/…) _(POST https://api.mcp.ai/api/openfinance/investments/transactions/list)_

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `investment_id` | string | Yes | Investment uuid. |
| `page` | number | No |  |
| `page_size` | number | No | 1-500, default 100. |

**Request body:**
```json
{
  "investment_id": "uuid-inv"
}
```


### Loans

#### `openfinance_list_loans`

Loan contracts per connection (batch) _(POST https://api.mcp.ai/api/openfinance/loans/list)_

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `items` | string[] | Yes | Connection selectors. 1-50. |

**Request body:**
```json
{
  "items": [
    "612"
  ]
}
```


### Categories

#### `openfinance_list_categories`

Transaction category taxonomy (Pluggy) _(POST https://api.mcp.ai/api/openfinance/categories/list)_


