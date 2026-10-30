import { getApiKeyByKey } from "@/lib/db/repos/apiKeysRepo.js";
import { extractClientApiKey } from "@/shared/utils/clientApiKey.js";
import { getCustomerQuota } from "@/lib/usage/customerQuota.js";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" };

export async function GET(request) {
  // This endpoint always requires the customer's key, even in local mode.
  const record = await getApiKeyByKey(extractClientApiKey(request));
  if (!record || record.isActive === false) return Response.json({ error: "Invalid API key" }, { status: 401, headers });
  try { return Response.json(await getCustomerQuota(record), { headers }); }
  catch { return Response.json({ error: "Quota temporarily unavailable" }, { status: 503, headers }); }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...headers,
    "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, x-api-key, x-goog-api-key" } });
}
