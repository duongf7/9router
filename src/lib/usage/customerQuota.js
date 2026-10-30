import { createHash } from "node:crypto";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo.js";
import { readProviderUsage } from "./providerUsage.js";
import { CUSTOMER_QUOTA_SCHEMA_VERSION, CUSTOMER_QUOTA_CACHE_MS, CUSTOMER_QUOTA_TIMEOUT_MS,
  CUSTOMER_QUOTA_CACHE_SIZE, CUSTOMER_QUOTA_CONCURRENCY } from "@/shared/constants/customerQuota.js";

// Only sanitized snapshots are cached. Never expose provider credentials,
// account emails, raw API errors, reset-credit actions or administrator data.
const cache = new Map();
const finite = n => typeof n === "number" && Number.isFinite(n);
const percentage = n => finite(n) ? Math.max(0, Math.min(100, n)) : null;

export function normalizeQuota(usage, now = new Date().toISOString()) {
  const limits = Object.entries(usage?.quotas || {}).flatMap(([name, q]) => {
    if (!q || typeof q !== "object") return [];
    let remainingPercent = percentage(q.remainingPercentage);
    if (remainingPercent === null && finite(q.total) && q.total > 0) {
      if (finite(q.remaining)) remainingPercent = percentage(100 * q.remaining / q.total);
      else if (finite(q.used)) remainingPercent = percentage(100 * (1 - q.used / q.total));
    }
    const reset = q.resetAt ? Date.parse(q.resetAt) : NaN;
    const currency = typeof q.currency === "string" && /^[a-z]{3}$/i.test(q.currency) ? q.currency.toUpperCase() : null;
    const unit = ["tokens", "credits", "requests"].includes(q.unit) ? q.unit : q.unit === "currency" && currency ? "currency" : null;
    const remaining = unit && finite(q.remaining) && q.remaining >= 0 ? q.remaining : null;
    const total = unit && finite(q.total) && q.total >= 0 ? q.total : null;
    return [{ label: name.slice(0, 120), remainingPercent,
      remaining, total, unit, currency: unit === "currency" ? currency : null,
      resetAt: Number.isFinite(reset) ? new Date(reset).toISOString() : null,
      unlimited: q.unlimited === true }];
  });
  return {
    status: limits.some(q => q.remainingPercent !== null || q.remaining !== null || q.unlimited) ? "available" : "unavailable",
    // Provider-side caches can return an older value; preserve their timestamp.
    updatedAt: usage?.cachedAt && Number.isFinite(Date.parse(usage.cachedAt)) ? new Date(usage.cachedAt).toISOString() : now,
    limits,
  };
}

async function accountQuota(connection) {
  let entry = cache.get(connection.id);
  if (entry?.pending) return entry.pending;
  if (entry?.expiresAt > Date.now()) return entry.snapshot;
  if (!entry) {
    // Bounded cache; dropping a completed entry never changes routing or scope.
    if (cache.size >= CUSTOMER_QUOTA_CACHE_SIZE) {
      const oldest = [...cache].find(([, item]) => !item.pending);
      if (oldest) cache.delete(oldest[0]);
      else return { status: "unavailable", updatedAt: null, limits: [] };
    }
    entry = {};
    cache.set(connection.id, entry);
  }
  let timer;
  const unavailable = { status: "unavailable", updatedAt: null, limits: [] };
  const work = readProviderUsage(connection).then(normalizeQuota, () => unavailable);
  // Coalesce readers and cache timeouts too, so a stalled provider can recover
  // on the next refresh without being hammered by every UI poll.
  const timed = new Promise(resolve => {
    timer = setTimeout(() => resolve(unavailable), CUSTOMER_QUOTA_TIMEOUT_MS);
  });
  entry.pending = Promise.race([work, timed]).then(snapshot => {
    entry.snapshot = snapshot;
    entry.expiresAt = Date.now() + CUSTOMER_QUOTA_CACHE_MS;
    return snapshot;
  }).finally(() => {
    clearTimeout(timer);
    entry.pending = null;
  });
  return entry.pending;
}

export async function getCustomerQuota(key) {
  const result = { schemaVersion: CUSTOMER_QUOTA_SCHEMA_VERSION, source: "9router",
    status: "unavailable", reason: null, accounts: [] };
  if (!key || key.isActive === false) { result.reason = "inactive_key"; return result; }
  if (key.connectionAccess?.restricted !== true) {
    result.reason = "account_assignment_required";
    return result;
  }
  const allowed = new Set(key.connectionAccess.allow || []);
  if (!allowed.size) { result.reason = "no_assigned_accounts"; return result; }
  const accounts = (await getProviderConnections()).filter(c => allowed.has(c.id));
  // Small batches keep a customer polling many assigned accounts from flooding providers.
  for (let i = 0; i < accounts.length; i += CUSTOMER_QUOTA_CONCURRENCY) {
    const batch = await Promise.all(accounts.slice(i, i + CUSTOMER_QUOTA_CONCURRENCY).map(async c => ({
      id: createHash("sha256").update(`${key.id}:${c.id}`).digest("hex").slice(0, 16),
      provider: c.provider,
      ...(c.isActive === false ? { status: "paused", updatedAt: null, limits: [] } : await accountQuota(c)),
    })));
    result.accounts.push(...batch);
  }
  if (!accounts.length) result.reason = "no_assigned_accounts";
  const available = result.accounts.filter(c => c.status === "available").length;
  result.status = available === result.accounts.length && available > 0 ? "available" : available > 0 ? "partial" : "unavailable";
  return result;
}
