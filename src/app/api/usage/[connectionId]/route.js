import { getProviderConnectionById } from "@/lib/localDb";
import { readProviderUsage } from "@/lib/usage/providerUsage.js";

export async function GET(request, { params }) {
  try {
    const { connectionId } = await params;
    const connection = await getProviderConnectionById(connectionId);
    if (!connection) return Response.json({ error: "Connection not found" }, { status: 404 });
    const force = new URL(request.url).searchParams.get("force") === "1";
    return Response.json(await readProviderUsage(connection, { force }));
  } catch (error) {
    return Response.json({ error: error.message }, { status: error.status || 500 });
  }
}
