import { reserveTokens, settleTokens, TokenBudgetError } from "@/lib/db/repos/tokenBudgetRepo.js";
import { TOKEN_BUDGET_DEFAULT_OUTPUT } from "@/shared/constants/tokenBudget.js";
import { estimateInputTokens, canonicalizeUsage } from "open-sse/utils/usageTracking.js";

function denied(error) {
  const known = error instanceof TokenBudgetError;
  const status = known ? error.status : 503;
  const message = known ? error.message : "Token allowance is temporarily unavailable. Please retry.";
  return { success: false, budgetDenied: true, status, error: message,
    response: Response.json({ error: { message, type: "quota_error", code: known ? error.code : "token_quota_unavailable" } },
      { status, headers: { "Access-Control-Allow-Origin": "*" } }) };
}

function outputLimit(body) {
  const values = [body.max_completion_tokens, body.max_output_tokens, body.max_tokens, body.generationConfig?.maxOutputTokens]
    .filter(v => Number.isSafeInteger(v) && v > 0);
  return values.length ? Math.min(...values) : TOKEN_BUDGET_DEFAULT_OUTPUT;
}

function cappedBody(body, limit) {
  const copy = { ...body };
  let found = false;
  for (const field of ["max_tokens", "max_completion_tokens", "max_output_tokens"]) {
    if (copy[field] != null) { copy[field] = limit; found = true; }
  }
  if (copy.generationConfig) {
    copy.generationConfig = { ...copy.generationConfig, maxOutputTokens: limit }; found = true;
  }
  if (!found) copy[copy.input !== undefined ? "max_output_tokens" : "max_tokens"] = limit;
  return copy;
}

// One durable reservation per upstream attempt. Callback receipts are independent
// of HTTP stream lifetime; no in-memory counter is trusted for enforcement.
export async function withTokenBudget(options, execute) {
  if (!options.apiKey) return execute(options);
  let hold;
  try {
    hold = await reserveTokens(options.apiKey, Math.max(1, estimateInputTokens(options.body)), outputLimit(options.body));
  } catch (error) { return denied(error); }
  if (!hold) return execute(options);
  let started = false;
  let usageTask = null;
  let finished = false;
  const finish = async (release = false) => {
    if (finished) return;
    finished = true;
    if (usageTask) await usageTask;
    await settleTokens(hold.id, release || !started ? 0 : hold.amount, release || !started ? "released" : "estimated");
  };
  const onTokenUsage = (tokens, estimated = false) => {
    const usage = canonicalizeUsage(tokens);
    // Existing client-facing estimates add a context safety buffer. It is not
    // consumed usage, so exclude that buffer from the customer's allowance.
    const input = estimated ? estimateInputTokens(options.body) : usage?.prompt_tokens;
    const amount = usage ? Math.ceil(input + usage.completion_tokens) : NaN;
    if (!Number.isSafeInteger(amount) || amount < 0) return;
    // Start settlement immediately; the stream wrapper awaits it before closing.
    usageTask = (usageTask || Promise.resolve()).then(() => settleTokens(hold.id, amount, estimated ? "estimated" : "actual"));
    usageTask.catch(() => {}); // Observed again by finish; retain hold on failure.
  };
  try {
    const result = await execute({ ...options, body: cappedBody(options.body, hold.output),
      onTokenUsage, tokenBudgetAttempt: { markStarted: () => { started = true; } } });
    if (!result.success) {
      // Definitive upstream rejection consumed no generation. Network failures
      // and disconnects remain estimated when the request already went upstream.
      await finish(result.status >= 400 && result.status < 500 && ![408, 499].includes(result.status));
      return result;
    }
    const response = result.response;
    if (!response?.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
      await finish(); return result;
    }
    const reader = response.body.getReader();
    const body = new ReadableStream({
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) { await finish(); controller.close(); }
          else controller.enqueue(chunk.value);
        } catch (error) {
          try { await finish(); } finally { controller.error(error); }
        }
      },
      async cancel(reason) {
        try { await reader.cancel(reason); } finally { await finish(); }
      },
    });
    return { ...result, response: new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers }) };
  } catch (error) {
    try { await finish(); } catch {}
    return denied(error);
  }
}
