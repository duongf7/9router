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

For Docker updates, keep the existing `/app/data` bind mount or named volume.
Before switching containers, back up the database and container configuration;
verify migration on a copy first. Updating the application does not assign
accounts to existing customer keys automatically.

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

The Revit integration probes this contract at the configured API base using
the current session's customer key. Its compact footer shows context usage and
quota separately, with the balance unit and reset time when supplied. It hides
input/output totals and provider/account implementation details. Unrecognized
contracts show "Not supported"; API failures show "Temporarily unavailable".
Neither blocks chat or context statistics. Other vendors require compatible
quota endpoints or their own adapters. Updating 9router does not install a new
Revit client build.

## Local verification

From `tests`, run the `connection-access*`, `customer-quota`, `key-access*`,
`antigravity-quota-routing`, `codex-reset-credits` and `quota-auto-ping` unit tests.
They use synthetic credentials and isolated temporary databases. Run
`npm run build` from the repository root to compile the dashboard and routes.

Verified locally on 2026-10-30:

- 155 tests passed across 10 suites with two workers, including nested combo/retry isolation,
  key transports, API validation, migration/backup and quota failure recovery.
- Headless Chrome against Next dev passed create/edit account assignments,
  authenticated quota reads and quota rendering. Subscription percentages were
  synthetic fixtures; no real customer's allowance was consumed.
- The Linux amd64 production image passed its build and packaged health/quota
  checks in [GitHub Actions](https://github.com/duongf7/9router/actions/runs/41071907374).
  The compiler uses a 4 GiB Node heap only during the build; the VPS runtime
  does not inherit that setting. The image contains version `0.5.112` at commit
  `5360ef31a6a53c1a71bc1ecc23a9030088315c1a`.

## VPS deployment verification — 2026-10-30

The owner's existing Docker installation was updated from `0.5.85` to this
custom `0.5.112` image. A copied database passed migration checks in a container
with networking disabled before production was switched.

- The existing data mount, loopback ports, restart policy and application
  environment were preserved. Only the 9router container was replaced.
- All existing fields in customer keys, provider connections, provider nodes,
  settings and alias/configuration records matched the backup after migration.
  All 7 keys, 8 provider connections and 3,512 usage-history records remained.
- Packaged health, unauthenticated quota rejection, authenticated quota reads
  and model listing passed. No inference request or subscription usage was
  generated by these deployment checks.
- Existing unrestricted keys return `account_assignment_required` for quota.
  Assign each customer key to its intended account in the dashboard to enable
  account isolation and its subscription quota; deployment does not choose
  those assignments for the owner.
- At the owner's request, the previous container and image were deleted after
  verification. The consistent pre-update data/configuration backup remains
  under `/opt/9router-deployments/5360ef31/before-update` on the VPS.

The `Custom VPS image` GitHub Actions workflow produces the image archive,
revision metadata and SHA-256 checksum for subsequent builds. Always preserve
the data mount and verify a backup before replacing a running container.
