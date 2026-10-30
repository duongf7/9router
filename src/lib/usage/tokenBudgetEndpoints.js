import { getApiKeyByKey } from "@/lib/db/repos/apiKeysRepo.js";
import { extractClientApiKey } from "@/shared/utils/clientApiKey.js";

export async function rejectNonChatTokenBudget(request, force = false) {
  if (request.method !== "POST") return null;
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  const chat = /^\/(?:api\/)?v1\/(?:chat\/completions|messages|responses(?:\/compact)?)$/.test(path)
    || path === "/responses" || path.startsWith("/codex/") || path === "/codex"
    || /^\/(?:api\/)?v1beta\/models\/.+:(?:streamGenerateContent|generateContent)$/.test(path);
  if (!force && chat) return null;
  const key = extractClientApiKey(request);
  if (!key) return null;
  const record = await getApiKeyByKey(key);
  if (!record?.tokenBudget || record.tokenBudget.mode === "none") return null;
  return Response.json({ error: { message: "This token allowance covers chat and agent requests only.", code: "token_budget_chat_only", type: "permission_error" } },
    { status: 403, headers: { "Access-Control-Allow-Origin": "*" } });
}
