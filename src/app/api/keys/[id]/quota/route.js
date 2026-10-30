import { getApiKeyById } from "@/lib/db/repos/apiKeysRepo.js";
import { getCustomerQuota } from "@/lib/usage/customerQuota.js";

// Dashboard authentication is enforced by dashboardGuard for /api/keys/*.
export async function GET(request, { params }) {
  const { id } = await params;
  const key = await getApiKeyById(id);
  if (!key) return Response.json({ error: "Key not found" }, { status: 404 });
  try { return Response.json(await getCustomerQuota(key), { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "Quota temporarily unavailable" }, { status: 503 }); }
}
