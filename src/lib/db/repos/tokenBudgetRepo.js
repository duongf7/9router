import { randomUUID } from "node:crypto";
import { getAdapter } from "../driver.js";
import { parseTokenBudget, nextTokenBudgetMonth, validateTokenBudget } from "@/shared/utils/tokenBudget.js";
import { TOKEN_BUDGET_MAX, TOKEN_BUDGET_RESERVATION_MS, TOKEN_BUDGET_RETENTION_MS } from "@/shared/constants/tokenBudget.js";

export class TokenBudgetError extends Error {
  constructor(message, status = 429, code = "token_quota_exceeded") {
    super(message); this.status = status; this.code = code;
  }
}

function writeState(db, keyId, state) {
  db.run("UPDATE apiKeys SET tokenBudget = ? WHERE id = ?", [JSON.stringify(state), keyId]);
}

// Runs inside the caller's SQLite transaction. Stale reservations remain charged
// conservatively after a process restart; a late usage receipt can reconcile them.
function currentState(db, row, now) {
  let state = parseTokenBudget(row.tokenBudget);
  if (!state) return null;
  if (state.mode === "monthly" && Date.parse(state.resetAt) <= now) {
    const date = new Date(now);
    state = { ...state, used: 0, extra: 0,
      periodStart: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString(),
      resetAt: nextTokenBudgetMonth(now) };
  }
  const expired = db.all("SELECT * FROM tokenReservations WHERE keyId = ? AND state = 'reserved' AND expiresAt <= ?", [row.id, now]);
  for (const entry of expired) {
    if (entry.periodStart === state.periodStart) state.used += entry.amount;
    db.run("UPDATE tokenReservations SET state = 'estimated', charged = amount WHERE id = ?", [entry.id]);
  }
  if (JSON.stringify(state) !== row.tokenBudget) writeState(db, row.id, state);
  return state;
}

function snapshot(db, keyId, state) {
  if (!state || state.mode === "none") return { mode: "none" };
  const reserved = db.get("SELECT COALESCE(SUM(amount),0) AS n FROM tokenReservations WHERE keyId = ? AND periodStart = ? AND state = 'reserved'", [keyId, state.periodStart]).n;
  const total = state.limit + state.extra;
  return { ...state, total, reserved, remaining: Math.max(0, total - state.used - reserved) };
}

export async function getTokenBudget(keyId, now = Date.now()) {
  const db = await getAdapter();
  return db.transaction(() => {
    const row = db.get("SELECT id, tokenBudget FROM apiKeys WHERE id = ?", [keyId]);
    return row ? snapshot(db, keyId, currentState(db, row, now)) : { mode: "none" };
  });
}

// Used by the existing API-key transaction: unrelated edits never reset usage.
export function configureTokenBudget(db, keyId, value, now = Date.now()) {
  const checked = validateTokenBudget(value);
  if (!checked.ok) throw new TokenBudgetError(checked.error, 400, "invalid_token_budget");
  const row = db.get("SELECT id, tokenBudget FROM apiKeys WHERE id = ?", [keyId]);
  if (!row) throw new TokenBudgetError("Key not found", 404, "key_not_found");
  const old = currentState(db, row, now);
  if (old && old.mode !== checked.value.mode
      && db.get("SELECT COUNT(*) AS n FROM tokenReservations WHERE keyId = ? AND state = 'reserved'", [keyId]).n) {
    throw new TokenBudgetError("Wait for this key's active requests to finish before changing its cycle.", 409, "token_budget_busy");
  }
  const state = { ...checked.value, used: old?.used || 0, extra: old?.extra || 0,
    periodStart: old?.periodStart || new Date(now).toISOString(),
    resetAt: checked.value.mode === "monthly" ? (old?.resetAt || nextTokenBudgetMonth(now)) : null };
  if (state.limit + state.extra > TOKEN_BUDGET_MAX) throw new TokenBudgetError("Token allowance is too large.", 400, "invalid_token_budget");
  writeState(db, keyId, state);
  return snapshot(db, keyId, state);
}

export async function addTokenBudget(keyId, amount, now = Date.now()) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > TOKEN_BUDGET_MAX) {
    throw new TokenBudgetError("Enter a positive whole number of tokens.", 400, "invalid_token_budget");
  }
  const db = await getAdapter();
  return db.transaction(() => {
    const row = db.get("SELECT id, tokenBudget FROM apiKeys WHERE id = ?", [keyId]);
    if (!row) throw new TokenBudgetError("Key not found", 404, "key_not_found");
    const state = currentState(db, row, now);
    if (!state || state.mode === "none") throw new TokenBudgetError("Set a token allowance first.", 400, "invalid_token_budget");
    if (state.limit + state.extra + amount > TOKEN_BUDGET_MAX) throw new TokenBudgetError("Token allowance is too large.", 400, "invalid_token_budget");
    state.extra += amount;
    writeState(db, keyId, state);
    return snapshot(db, keyId, state);
  });
}

export async function reserveTokens(apiKey, inputEstimate, outputRequested, now = Date.now()) {
  if (!apiKey) return null;
  if (![inputEstimate, outputRequested].every(v => Number.isSafeInteger(v) && v > 0)) throw new Error("Invalid token reservation");
  const db = await getAdapter();
  return db.transaction(() => {
    const row = db.get("SELECT id, isActive, tokenBudget FROM apiKeys WHERE key = ?", [apiKey]);
    if (!row) throw new TokenBudgetError("Invalid API key.", 401, "invalid_api_key");
    if (!row.isActive) throw new TokenBudgetError("This API key is paused.", 401, "inactive_key");
    if (!row.tokenBudget) return null; // Existing unlimited requests.
    const state = currentState(db, row, now);
    if (!state || state.mode === "none") return null;
    const balance = snapshot(db, row.id, state);
    const output = Math.min(outputRequested, balance.remaining - inputEstimate);
    if (output < 1) throw new TokenBudgetError("Not enough tokens remain for this request. Add tokens or wait for the allowance to reset.");
    const entry = { id: randomUUID(), keyId: row.id, amount: inputEstimate + output, output };
    db.run("INSERT INTO tokenReservations(id,keyId,periodStart,amount,state,expiresAt) VALUES(?,?,?,?,?,?)",
      [entry.id, row.id, state.periodStart, entry.amount, "reserved", now + TOKEN_BUDGET_RESERVATION_MS]);
    db.run("DELETE FROM tokenReservations WHERE keyId = ? AND state != 'reserved' AND expiresAt < ?", [row.id, now - TOKEN_BUDGET_RETENTION_MS]);
    return entry;
  });
}

export async function settleTokens(id, amount, kind = "actual", now = Date.now()) {
  if (!id) return;
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Invalid token usage");
  const db = await getAdapter();
  db.transaction(() => {
    const entry = db.get("SELECT * FROM tokenReservations WHERE id = ?", [id]);
    if (!entry || entry.state === "actual" || (entry.state !== "reserved" && kind !== "actual")) return;
    const row = db.get("SELECT id, tokenBudget FROM apiKeys WHERE id = ?", [entry.keyId]);
    if (row) {
      const state = currentState(db, row, now);
      // Re-read after expiry settlement to avoid charging a stale hold twice.
      const charged = db.get("SELECT charged FROM tokenReservations WHERE id = ?", [id]).charged;
      if (state && state.periodStart === entry.periodStart) {
        state.used = Math.max(0, state.used + amount - charged);
        writeState(db, row.id, state);
      }
    }
    db.run("UPDATE tokenReservations SET charged = ?, state = ? WHERE id = ?", [amount, kind, id]);
  });
}
