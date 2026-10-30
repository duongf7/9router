import { TOKEN_BUDGET_MAX } from "../constants/tokenBudget.js";

export function validateTokenBudget(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || !["none", "monthly", "lifetime"].includes(value.mode)) {
    return { ok: false, error: "Choose no limit, monthly, or until used up." };
  }
  if (value.mode !== "none" && (!Number.isSafeInteger(value.limit) || value.limit <= 0 || value.limit > TOKEN_BUDGET_MAX)) {
    return { ok: false, error: "Token allowance must be a positive whole number." };
  }
  return { ok: true, value: { mode: value.mode, limit: value.mode === "none" ? 0 : value.limit } };
}

export function parseTokenBudget(value) {
  if (value == null || value === "") return null;
  const state = typeof value === "string" ? JSON.parse(value) : value;
  const checked = validateTokenBudget(state);
  if (!checked.ok || ![state.used, state.extra].every(v => Number.isSafeInteger(v) && v >= 0)
      || state.extra + checked.value.limit > TOKEN_BUDGET_MAX
      || !Number.isFinite(Date.parse(state.periodStart))
      || (state.mode === "monthly" && !Number.isFinite(Date.parse(state.resetAt)))) {
    throw new Error("Invalid stored token allowance");
  }
  return { ...checked.value, used: state.used, extra: state.extra,
    periodStart: state.periodStart, resetAt: state.mode === "monthly" ? state.resetAt : null };
}

export function nextTokenBudgetMonth(now) {
  const date = new Date(now);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString();
}
