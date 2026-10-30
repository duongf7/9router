import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, updateApiKey } from "@/lib/localDb";
import { validateKeyAccessInput } from "@/shared/utils/keyAccess.js";
import { validateAssignedAccounts } from "@/lib/validateConnectionAccess.js";
import { validateTokenBudget } from "@/shared/utils/tokenBudget.js";
import { getTokenBudget, TokenBudgetError } from "@/lib/db/repos/tokenBudgetRepo.js";

// GET /api/keys/[id] - Get single key
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    return NextResponse.json({ key: { ...key, tokenBudget: await getTokenBudget(id) } });
  } catch (error) {
    console.log("Error fetching key:", error);
    return NextResponse.json({ error: "Failed to fetch key" }, { status: 500 });
  }
}

// PUT /api/keys/[id] - Update key
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { isActive, access, connectionAccess } = body;

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const updateData = {};
    if (body.tokenBudget !== undefined) {
      const checked = validateTokenBudget(body.tokenBudget);
      if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
      updateData.tokenBudget = checked.value;
    }
    if (connectionAccess !== undefined) {
      const checked = await validateAssignedAccounts(connectionAccess);
      if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
      updateData.connectionAccess = checked.value;
    }
    if (isActive !== undefined) updateData.isActive = isActive;
    if (access !== undefined) {
      const checked = validateKeyAccessInput(access);
      if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
      updateData.access = checked.value;
    }

    const updated = await updateApiKey(id, updateData);

    return NextResponse.json({ key: { ...updated, tokenBudget: await getTokenBudget(id) } });
  } catch (error) {
    if (error instanceof TokenBudgetError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.log("Error updating key:", error);
    return NextResponse.json({ error: "Failed to update key" }, { status: 500 });
  }
}

// DELETE /api/keys/[id] - Delete API key
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;

    const deleted = await deleteApiKey(id);
    if (!deleted) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Key deleted successfully" });
  } catch (error) {
    console.log("Error deleting key:", error);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}
