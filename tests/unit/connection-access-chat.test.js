import { beforeEach, expect, it, vi } from "vitest";
const fx = vi.hoisted(() => ({ accounts: [], key: {}, core: vi.fn(), combos: [] }));
vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ comboStrategy: "fallback" }),
  getProviderConnections: async ({ provider }) => fx.accounts.filter(c => c.provider === provider),
  getProviderConnectionById: async id => fx.accounts.find(c => c.id === id),
  getProxyPools: async () => [], validateApiKey: async () => true, updateProviderConnection: vi.fn(),
  getModelAliases: async () => ({}), getCustomModels: async () => [], getProviderNodes: async () => [],
  getComboByName: async name => fx.combos.find(c => c.name === name) || null,
  getCombos: async () => fx.combos,
}));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({ getApiKeyByKey: async () => fx.key }));
vi.mock("@/lib/db/repos/combosRepo.js", () => ({ getCombos: async () => fx.combos }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: async () => ({}), pickProxyPoolId: vi.fn() }));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: async (_p, c) => c, updateProviderCredentials: vi.fn() }));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: fx.core }));
vi.mock("@/sse/services/auth.js", async importOriginal => ({
  ...await importOriginal(), markAccountUnavailable: async () => ({ shouldFallback: true }), clearAccountError: vi.fn(),
}));
const { handleChat } = await import("@/sse/handlers/chat.js");
beforeEach(() => {
  vi.clearAllMocks();
  fx.key = { id: "key", isActive: true, access: { restricted: false, allow: [] }, connectionAccess: { restricted: true, allow: ["A"] } };
  fx.accounts = [
    { id: "B", provider: "openai", isActive: true, apiKey: "foreign" },
    { id: "A", provider: "openai", isActive: true, apiKey: "own" },
    { id: "C", provider: "anthropic", isActive: true, apiKey: "foreign-other-provider" },
  ];
  fx.combos = [{ name: "Main", models: ["Nested", "anthropic/claude-sonnet-4"] }, { name: "Nested", models: ["openai/gpt-4o", "openai/gpt-4.1"] }];
  fx.core.mockImplementation(async () => ({ success: false, status: 429, error: "Quota exhausted", response: new Response("Quota exhausted", { status: 429 }) }));
});
const call = model => handleChat(new Request("http://localhost/v1/chat/completions", {
  method: "POST", headers: { Authorization: "Bearer customer", "Content-Type": "application/json" },
  body: JSON.stringify({ model, stream: false, messages: [{ role: "user", content: "hello" }] }),
}));

it("real nested combo and account retry never invoke another customer's credentials", async () => {
  const response = await call("Main");
  expect(response.status).not.toBe(200);
  const attempts = fx.core.mock.calls.map(([args]) => [args.credentials.connectionId, args.modelInfo.model]);
  expect(attempts).toEqual([["A", "gpt-4o"], ["A", "gpt-4.1"]]);
});
it("an explicitly assigned fallback succeeds within the same customer pool", async () => {
  fx.key.connectionAccess.allow.push("B");
  fx.core.mockImplementation(async ({ credentials }) => credentials.connectionId === "B"
    ? { success: false, status: 429, error: "quota", response: new Response("quota", { status: 429 }) }
    : { success: true, response: Response.json({ choices: [{ message: { content: "ok" } }] }) });
  expect((await call("openai/gpt-4o")).status).toBe(200);
  expect(fx.core.mock.calls.map(([args]) => args.credentials.connectionId)).toEqual(["B", "A"]);
});
