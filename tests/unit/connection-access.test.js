import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectionAccessFromColumns, validateConnectionAccessInput } from "@/shared/utils/connectionAccess.js";

const fx = vi.hoisted(() => ({ keys: {}, accounts: [], settings: {}, updates: vi.fn() }));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({ getApiKeyByKey: async key => fx.keys[key] || null }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: async ({ provider }) => fx.accounts.filter(c => c.provider === provider && c.isActive),
  validateApiKey: vi.fn(), updateProviderConnection: fx.updates,
  getSettings: async () => fx.settings, getProxyPools: async () => [],
}));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: async () => ({}), pickProxyPoolId: vi.fn() }));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: { public: { noAuth: true } }, resolveProviderId: p => p === "cx" ? "codex" : p,
}));
vi.mock("@/sse/services/antigravityQuota.js", () => ({ getAntigravityQuotaCache: () => null, getAntigravityModelQuota: () => null }));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));
const { getProviderCredentials } = await import("@/sse/services/auth.js");
const { denyUnassignedPublicProvider } = await import("@/sse/services/connectionAccess.js");
const req = (key = "customer", headers = { Authorization: `Bearer ${key}` }, query = "") => new Request(`http://localhost/v1/chat/completions${query}`, { headers });

beforeEach(() => {
  vi.clearAllMocks();
  fx.settings = {};
  fx.keys = { customer: { id: "customer", isActive: true, connectionAccess: { restricted: true, allow: ["A"] } } };
  fx.accounts = [
    { id: "B", provider: "codex", isActive: true, accessToken: "other-secret", priority: 1 },
    { id: "A", provider: "codex", isActive: true, accessToken: "own-secret", priority: 2 },
    { id: "C", provider: "claude", isActive: true, accessToken: "other-provider-secret" },
  ];
});

describe("customer account isolation at credential selection", () => {
  it.each(["fill-first", "round-robin"])("%s chooses only assigned accounts, ignoring a foreign pin", async strategy => {
    fx.settings.fallbackStrategy = strategy;
    expect(await getProviderCredentials("cx", null, "gpt", { request: req(), preferredConnectionId: "B" }))
      .toMatchObject({ connectionId: "A", accessToken: "own-secret" });
    expect(fx.updates.mock.calls.every(([id]) => id === "A")).toBe(true);
  });
  it("exhausted retries cannot spill to another customer, new account, or provider", async () => {
    fx.accounts.unshift({ id: "new", provider: "codex", isActive: true });
    expect(await getProviderCredentials("codex", new Set(["A"]), "gpt", { request: req() })).toBeNull();
    expect(await getProviderCredentials("claude", null, "sonnet", { request: req() })).toBeNull();
  });
  it("can fall back to a second explicitly assigned account", async () => {
    fx.keys.customer.connectionAccess.allow.push("B");
    expect(await getProviderCredentials("codex", "A", "gpt", { request: req() })).toMatchObject({ connectionId: "B" });
  });
  it("returns the assigned account's cooldown without selecting an unlocked outsider", async () => {
    fx.accounts[1].modelLocks = undefined;
    fx.accounts[1]["modelLock_gpt"] = new Date(Date.now() + 60_000).toISOString();
    const result = await getProviderCredentials("codex", null, "gpt", { request: req() });
    expect(result).toMatchObject({ allRateLimited: true });
    expect(result.connectionId).toBeUndefined();
  });
  it.each(["empty", "paused", "deleted-account", "unknown-key", "paused-key"])("%s cannot use the pool", async scenario => {
    if (scenario === "empty") fx.keys.customer.connectionAccess.allow = [];
    if (scenario === "paused") fx.accounts[1].isActive = false;
    if (scenario === "deleted-account") fx.accounts.splice(1, 1);
    if (scenario === "unknown-key") delete fx.keys.customer;
    if (scenario === "paused-key") fx.keys.customer.isActive = false;
    expect(await getProviderCredentials("codex", null, "gpt", { request: req() })).toBeNull();
  });
  it("rechecks assignment and key status on the next retry", async () => {
    expect((await getProviderCredentials("codex", null, "gpt", { request: req() })).connectionId).toBe("A");
    fx.keys.customer.connectionAccess.allow = [];
    expect(await getProviderCredentials("codex", null, "gpt", { request: req() })).toBeNull();
  });
  it.each([
    [{ "x-api-key": "customer" }, ""], [{ "x-goog-api-key": "customer" }, ""], [{}, "?key=customer"],
  ])("honors all supported credential transports", async (headers, query) => {
    expect((await getProviderCredentials("codex", null, "gpt", { request: req("customer", headers, query) })).connectionId).toBe("A");
  });
  it("blocks no-auth paths for assigned-only keys", async () => {
    expect(await getProviderCredentials("public", null, "m", { request: req() })).toBeNull();
    expect((await denyUnassignedPublicProvider(req())).status).toBe(403);
  });
  it("preserves explicit unrestricted keys and local mode", async () => {
    fx.keys.customer.connectionAccess = { restricted: false, allow: [] };
    expect((await getProviderCredentials("codex", null, "gpt", { request: req() })).connectionId).toBe("B");
    expect((await getProviderCredentials("codex", null, "gpt")).connectionId).toBe("B");
  });
});

it("corrupt storage fails closed, and IDs are not case-folded", () => {
  expect(connectionAccessFromColumns(1, "broken")).toEqual({ restricted: true, allow: [] });
  expect(connectionAccessFromColumns("bad", "{}")).toEqual({ restricted: true, allow: [] });
  expect(connectionAccessFromColumns(1, '["A","a"]')).toEqual({ restricted: true, allow: ["A", "a"] });
  expect(validateConnectionAccessInput({ restricted: "false", allow: [] }).ok).toBe(false);
});
