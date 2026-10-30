import { NextResponse } from "next/server";
import { getApiKeys, createApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { validateAssignedAccounts } from "@/lib/validateConnectionAccess.js";
import { validateTokenBudget } from "@/shared/utils/tokenBudget.js";

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys
export async function GET() {
  try {
    const keys = await getApiKeys();
    return NextResponse.json({ keys });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request) {
  try {
    const body = await request.json();
    const { name } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    const budget = body.tokenBudget === undefined ? null : validateTokenBudget(body.tokenBudget);
    if (budget && !budget.ok) return NextResponse.json({ error: budget.error }, { status: 400 });

    const checked = await validateAssignedAccounts(body.connectionAccess === undefined ? { restricted: true, allow: [] } : body.connectionAccess);
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId, checked.value, budget?.value);

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      connectionAccess: apiKey.connectionAccess,
      tokenBudget: apiKey.tokenBudget,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
