import { getApiKeyByKey } from "@/lib/db/repos/apiKeysRepo.js";
import { extractClientApiKey } from "@/shared/utils/clientApiKey.js";

// Re-read on each selection, including retries: pausing a key or revoking an
// account takes effect before the next upstream attempt. Never trust body IDs.
export async function getConnectionAccess(request) {
  const key = extractClientApiKey(request);
  if (!key) return { restricted: false, allow: [] }; // local/admin mode; remote auth is in dashboardGuard
  const record = await getApiKeyByKey(key);
  if (!record || record.isActive === false) return { restricted: true, allow: [] };
  return record.connectionAccess || { restricted: false, allow: [] };
}

export async function denyUnassignedPublicProvider(request) {
  if (!(await getConnectionAccess(request)).restricted) return null;
  return Response.json({ error: { message: "This key may only use its assigned accounts.", type: "permission_error" } }, { status: 403 });
}
