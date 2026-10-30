import { beforeEach, expect, it, vi } from "vitest";
const fx = vi.hoisted(() => ({ accounts: [], keys: {}, read: vi.fn() }));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({ getApiKeyByKey: async key => fx.keys[key] || null }));
vi.mock("@/lib/db/repos/connectionsRepo.js", () => ({ getProviderConnections: async () => fx.accounts }));
vi.mock("@/lib/usage/providerUsage.js", () => ({ readProviderUsage: fx.read }));
let quota, route;
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  quota = await import("@/lib/usage/customerQuota.js");
  route = await import("@/app/api/v1/quota/route.js");
  fx.keys = { customer: { id: "key", isActive: true, connectionAccess: { restricted: true, allow: ["A"] } } };
  fx.accounts = [
    { id: "A", provider: "codex", isActive: true, email: "owner@example.com", accessToken: "SECRET" },
    { id: "B", provider: "claude", isActive: true, email: "other@example.com" },
  ];
  fx.read.mockResolvedValue({ email: "SECRET-EMAIL", plan: "SECRET-PLAN", quotas: {
    session: { used: 20, total: 100, remaining: 80, resetAt: "2026-11-01T00:00:00Z", token: "SECRET" },
    weekly: { remainingPercentage: 0 },
  } });
});
const request = (key = "customer") => new Request("http://localhost/v1/quota?connectionId=B&force=1", { headers: { Authorization: `Bearer ${key}` } });

it("preserves explicit token/credit/currency balances without inventing units", () => {
  const result = quota.normalizeQuota({ quotas: {
    credits: { remaining: 0, unit: "credits" },
    money: { remaining: 4.25, unit: "currency", currency: "usd" },
    tokens: { remaining: 500, total: 1000, unit: "tokens" },
    percentageOnly: { remaining: 20, total: 100 },
  } });
  expect(result.status).toBe("available");
  expect(result.limits[0]).toMatchObject({ remaining: 0, unit: "credits", remainingPercent: null });
  expect(result.limits[1]).toMatchObject({ remaining: 4.25, currency: "USD" });
  expect(result.limits[2]).toMatchObject({ remaining: 500, total: 1000, unit: "tokens", remainingPercent: 50 });
  expect(result.limits[3]).toMatchObject({ remaining: null, unit: null, remainingPercent: 20 });
});

it("only reads assigned accounts; output cannot expose raw provider or credential data", async () => {
  const response = await route.GET(request());
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(body).toMatchObject({ schemaVersion: 1, source: "9router", status: "available" });
  expect(fx.read).toHaveBeenCalledTimes(1);
  expect(fx.read.mock.calls[0][0].id).toBe("A");
  expect(body.accounts[0].id).not.toBe("A");
  expect(body.accounts[0].limits.map(l => l.remainingPercent)).toEqual([80, 0]);
  expect(JSON.stringify(body)).not.toMatch(/SECRET|example.com|accessToken|refreshToken/);
});
it("coalesces reads and caches quota, but rechecks assignment on every request", async () => {
  await Promise.all([route.GET(request()), route.GET(request()), route.GET(request())]);
  expect(fx.read).toHaveBeenCalledTimes(1);
  fx.keys.customer.connectionAccess.allow = [];
  expect((await (await route.GET(request())).json()).accounts).toEqual([]);
  expect(fx.read).toHaveBeenCalledTimes(1);
});
it("does not report a shared global pool to unrestricted keys", async () => {
  fx.keys.customer.connectionAccess.restricted = false;
  expect((await (await route.GET(request())).json()).reason).toBe("account_assignment_required");
  expect(fx.read).not.toHaveBeenCalled();
});
it("unknown and revoked keys cannot read quota even on localhost", async () => {
  expect((await route.GET(request("unknown"))).status).toBe(401);
  fx.keys.customer.isActive = false;
  expect((await route.GET(request())).status).toBe(401);
  expect(fx.read).not.toHaveBeenCalled();
});
it("missing quota is unknown, not zero or unlimited", () => {
  expect(quota.normalizeQuota({ quotas: { session: {} } })).toMatchObject({
    status: "unavailable", limits: [{ remainingPercent: null, unlimited: false, resetAt: null }],
  });
});
it("upstream failures do not disclose raw errors or query another account", async () => {
  fx.read.mockRejectedValue(new Error("SECRET refresh token"));
  const body = await (await route.GET(request())).json();
  expect(body.accounts).toHaveLength(1);
  expect(body.accounts[0]).toMatchObject({ status: "unavailable", limits: [] });
  expect(JSON.stringify(body)).not.toContain("SECRET");
});
it("paused accounts are not queried, partial quotas stay separate", async () => {
  fx.keys.customer.connectionAccess.allow.push("B");
  fx.accounts[1].isActive = false;
  const body = await (await route.GET(request())).json();
  expect(body.status).toBe("partial");
  expect(body.accounts.map(c => c.status)).toEqual(["available", "paused"]);
  expect(fx.read).toHaveBeenCalledTimes(1);
});

it("times out a stalled read, then recovers after the cache interval", async () => {
  vi.useFakeTimers();
  try {
    fx.read.mockImplementationOnce(() => new Promise(() => {}));
    const stalled = route.GET(request());
    await vi.advanceTimersByTimeAsync(12_001);
    expect((await (await stalled).json()).accounts[0].status).toBe("unavailable");
    await route.GET(request());
    expect(fx.read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_001);
    expect((await (await route.GET(request())).json()).accounts[0].status).toBe("available");
    expect(fx.read).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});
