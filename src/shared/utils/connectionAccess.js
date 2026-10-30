import { validateKeyAccessInput } from "./keyAccess.js";

// Connection IDs are exact, case-sensitive identifiers, unlike model aliases.
export function validateConnectionAccessInput(input) {
  const checked = validateKeyAccessInput(input);
  if (!checked.ok) return { ok: false, error: checked.error.replaceAll("access", "connectionAccess") };
  return { ok: true, value: {
    restricted: input.restricted,
    allow: input.restricted ? [...new Set((input.allow || []).map(id => id.trim()).filter(Boolean))] : [],
  } };
}

export function connectionAccessFromColumns(restricted, allow) {
  // Missing columns belong to old databases; malformed flags/lists fail closed.
  if (restricted === undefined || restricted === null || restricted === 0 || restricted === false) {
    return { restricted: false, allow: [] };
  }
  let parsed;
  try { parsed = JSON.parse(allow); } catch { parsed = []; }
  const checked = validateConnectionAccessInput({ restricted: true, allow: parsed });
  return checked.ok ? checked.value : { restricted: true, allow: [] };
}

export function connectionAccessToColumns(access = { restricted: false, allow: [] }) {
  const checked = validateConnectionAccessInput(access);
  if (!checked.ok) throw new Error(checked.error);
  return {
    connectionAccessRestricted: checked.value.restricted ? 1 : 0,
    connectionAccessAllow: JSON.stringify(checked.value.allow),
  };
}

export function permitsConnection(access, id) {
  return access?.restricted === false || (access?.restricted === true && access.allow?.includes(id) === true);
}
