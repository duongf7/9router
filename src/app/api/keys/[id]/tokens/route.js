import { addTokenBudget, TokenBudgetError } from "@/lib/db/repos/tokenBudgetRepo.js";

// Dashboard authentication follows the existing /api/keys boundary.
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    return Response.json({ tokenBudget: await addTokenBudget(id, body.amount) });
  } catch (error) {
    if (error instanceof TokenBudgetError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return Response.json({ error: "Invalid request" }, { status: 400 });
    return Response.json({ error: "Could not add tokens." }, { status: 500 });
  }
}
