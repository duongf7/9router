import { getProviderConnections } from "./db/repos/connectionsRepo.js";
import { validateConnectionAccessInput } from "@/shared/utils/connectionAccess.js";

export async function validateAssignedAccounts(input) {
  const checked = validateConnectionAccessInput(input);
  if (!checked.ok) return checked;
  if (checked.value.restricted && checked.value.allow.length) {
    const ids = new Set((await getProviderConnections()).map(c => c.id));
    if (checked.value.allow.some(id => !ids.has(id))) {
      return { ok: false, error: "An assigned account no longer exists. Refresh the account list." };
    }
  }
  return checked;
}
