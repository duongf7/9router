# Customer account isolation and quota

## Configure a customer

1. Add the customer's subscription account under **Providers**.
2. Open **Endpoint → API Keys → Create Key**. Select **Assigned accounts only**,
   then select that account. Give the generated key to the customer.
3. Use **View subscription quota** on the key to inspect its assigned balance.

One customer key assigned to one dedicated subscription account gives that
customer access to that account's remaining allowance. Adding a new account to
9router does not grant it to existing restricted keys. Retries, nested combos,
capacity adapters, smart routing and media requests stay inside the assigned
list. With several assigned accounts, fallback may use any of those accounts.
When all assigned accounts are unavailable, the request fails instead of using
someone else's subscription. No-auth public providers are excluded from
assigned-only keys. Model/combo access restrictions still apply independently.

An account deliberately assigned to several keys has a shared subscription
balance. Usage in the provider's own app also consumes that balance. This is
not a prepaid per-key token ledger, billing system or guarantee of fixed token
capacity. Provider limits and reset windows remain authoritative.

## Existing installations

Schema version 3 adds two columns to `apiKeys`. The existing migration mechanism
takes a safety backup first. Existing keys and old backups retain unrestricted
account access for compatibility; use **All accounts · unrestricted → Edit**
to assign each existing customer key. New keys default to assigned-only with an
empty list and cannot infer until assigned. The automatically provisioned local
Default Key remains explicitly unrestricted.

The scope is preserved by database export/import. Corrupt restricted lists deny
access; removed or paused accounts do not cause a switch to unassigned accounts.
Remote clients still require key authentication through the existing gateway.
Keep dashboard login enabled and do not give customers administrator keys.

No Docker/VPS migration or deployment is part of this change. Preserve the
existing data volume when eventually updating the image.

## Client quota contract

`GET /v1/quota` (also `/api/v1/quota`) requires the customer's existing API key.
Bearer, `x-api-key` and the existing Google key transports are accepted. It is a
read-only endpoint with `Cache-Control: no-store`; no administrator credential
is needed. Arbitrary connection IDs or force-refresh query parameters are ignored.

```json
{
  "schemaVersion": 1,
  "source": "9router",
  "status": "available",
  "reason": null,
  "accounts": [{
    "id": "opaque-reference",
    "provider": "codex",
    "status": "available",
    "updatedAt": "2026-10-30T00:00:00.000Z",
    "limits": [{
      "label": "session",
      "remainingPercent": 80,
      "resetAt": "2026-10-30T05:00:00.000Z",
      "unlimited": false
    }]
  }]
}
```

- Overall status: `available`, `partial`, `unavailable`. Account status also
  supports `paused`. Never interpret an unavailable value as zero or unlimited.
- `reason`: `account_assignment_required`, `no_assigned_accounts`, `inactive_key`,
  or null. The public endpoint returns 401 for invalid/paused keys. Unrestricted
  keys are not given a list of every customer's quota.
- Each limit is a separate provider window/model bucket. Do not sum percentages
  across accounts or windows. Zero is a valid exhausted balance.
- Limits may additionally contain `remaining`, `total`, `unit` and `currency`.
  Units are `tokens`, `credits`, `requests`, or `currency` with a three-letter
  currency code. Absolute balances are returned only for explicit units;
  a synthetic percentage denominator of 100 is not treated as 100 tokens.
  A balance can be available without a total, percentage or reset time.
- `updatedAt` is the observation time, not a guarantee of a fresh provider read.
  Provider caching still applies. Reads are coalesced and cached for 60 seconds;
  errors/timeouts appear as unavailable without leaking raw upstream errors.
- No emails, account names, provider tokens, raw account IDs, admin endpoints or
  reset-credit actions are returned. References are scoped to the customer key.

`QuotaSummary` consumes this source-independent shape. A future Antigravity
Manager adapter can produce the same shape after mapping the customer to that
service's assigned accounts. It must enforce its own account boundary; the
9router restriction cannot control a client connecting directly to AG Manager.
AG Manager has not been forked or changed here.

For Revit, keep context-window usage and conversation token totals separate
from this subscription balance. A direct provider without a compatible quota
endpoint should show “Quota unavailable”, while context/token stats still work.
The Revit helper now probes this contract at the configured API base, using
the current session's customer key. Its footer separates context, conversation
token totals and account quota. Unrecognized contracts show "Not supported";
API failures show "Temporarily unavailable". Neither blocks chat. The matching
9router server build still needs deployment before a hosted endpoint can
return the new contract. Other vendors require their own quota adapters.

## Local verification

From `tests`, run the `connection-access*`, `customer-quota`, `key-access*`,
`antigravity-quota-routing`, `codex-reset-credits` and `quota-auto-ping` unit tests.
They use synthetic credentials and isolated temporary databases. Run
`npm run build` from the repository root to compile the dashboard and routes.

Verified locally on 2026-10-30:

- 154 tests passed across 10 suites, including nested combo/retry isolation,
  key transports, API validation, migration/backup and quota failure recovery.
- Headless Chrome against Next dev passed create/edit account assignments,
  authenticated quota reads and quota rendering. Subscription percentages were
  synthetic fixtures; no real customer's allowance was consumed.
- Production build is **not yet verified**: the default Node heap ran out of
  memory; additional attempts were stopped under workstation memory pressure.
  Temporary build settings were restored. Complete a production build before
  deploying the image. No VPS changes have been made.
