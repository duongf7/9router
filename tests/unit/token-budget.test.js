import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { TABLES, buildCreateTableSql } from "@/lib/db/schema.js";

const fx = vi.hoisted(() => ({ db: null }));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => fx.db }));
import { configureTokenBudget, getTokenBudget, addTokenBudget, reserveTokens, settleTokens } from "@/lib/db/repos/tokenBudgetRepo.js";
import { getApiKeyById, updateApiKey } from "@/lib/db/repos/apiKeysRepo.js";
import { withTokenBudget } from "@/lib/usage/tokenBudgetChat.js";
import { getCustomerQuota } from "@/lib/usage/customerQuota.js";
vi.mock("@/lib/usage/providerUsage.js", () => ({ readProviderUsage: vi.fn() }));
import { readProviderUsage } from "@/lib/usage/providerUsage.js";
import { PUT } from "@/app/api/keys/[id]/route.js";
import { POST as topUp } from "@/app/api/keys/[id]/tokens/route.js";
import { exportDb, importDb } from "@/lib/db/index.js";
import { rejectNonChatTokenBudget } from "@/lib/usage/tokenBudgetEndpoints.js";

const now = Date.parse("2026-10-30T12:00:00Z");
let raw;
beforeEach(() => {
  raw = new DatabaseSync(":memory:");
  let serial = 0;
  fx.db = {
    run: (sql, p = []) => raw.prepare(sql).run(...p), get: (sql, p = []) => raw.prepare(sql).get(...p),
    all: (sql, p = []) => raw.prepare(sql).all(...p), exec: sql => raw.exec(sql),
    transaction: fn => { const name = `t${serial++}`; raw.exec(`SAVEPOINT ${name}`); try { const result = fn(); raw.exec(`RELEASE ${name}`); return result; } catch (e) { raw.exec(`ROLLBACK TO ${name}; RELEASE ${name}`); throw e; } },
  };
  for (const [name, def] of Object.entries(TABLES)) raw.exec(buildCreateTableSql(name, def));
  raw.prepare("INSERT INTO apiKeys(id,key,name,isActive,createdAt) VALUES(?,?,?,?,?)").run("K", "synthetic-key", "Customer", 1, new Date(now).toISOString());
  vi.clearAllMocks();
});
afterEach(() => { raw.close(); vi.useRealTimers(); });
const configure = (mode = "lifetime", limit = 1000) => fx.db.transaction(() => configureTokenBudget(fx.db, "K", { mode, limit }, now));

it("leaves old keys unlimited and validates allowance values", async () => {
  expect(await reserveTokens("synthetic-key", 100, 100, now)).toBeNull();
  expect(await getTokenBudget("K", now)).toEqual({ mode: "none" });
  for (const limit of [0, -1, 1.5, "100", Infinity]) expect(() => configure("monthly", limit)).toThrow();
});

it("preserves allowance in JSON backups; legacy backups stay unlimited", async () => {
  configure("monthly");
  const hold = await reserveTokens("synthetic-key", 100, 100);
  await settleTokens(hold.id, 150);
  await addTokenBudget("K", 200);
  const dump = await exportDb();
  await importDb(dump);
  expect(await getTokenBudget("K")).toMatchObject({ mode: "monthly", used: 150, extra: 200, remaining: 1050 });
  await expect(importDb({ ...dump, apiKeys: [{ ...dump.apiKeys[0], tokenBudget: { mode: "lifetime", limit: 100 } }] })).rejects.toThrow();
  expect((await getTokenBudget("K")).used).toBe(150);
  await importDb({ ...dump, apiKeys: dump.apiKeys.map(({ tokenBudget, ...key }) => key) });
  expect(await getTokenBudget("K")).toEqual({ mode: "none" });
});

it("exports pending holds conservatively and refuses a restore during live work", async () => {
  configure();
  const hold = await reserveTokens("synthetic-key", 100, 100);
  const dump = await exportDb();
  expect(dump.apiKeys[0].tokenBudget.used).toBe(200);
  await expect(importDb(dump)).rejects.toThrow(/finish/);
  await settleTokens(hold.id, 120);
  await importDb(dump);
  expect((await getTokenBudget("K")).used).toBe(200);
});

it("does not let a chat allowance buy unmetered media or native TTS", async () => {
  configure();
  const call = (path, force = false) => rejectNonChatTokenBudget(new Request(`http://localhost${path}`, {
    method: "POST", headers: { "x-api-key": "synthetic-key" },
  }), force);
  for (const path of ["/v1/images/generations", "/api/v1/audio/speech", "/v1/embeddings", "/v1/systemone"]) {
    expect((await call(path)).status).toBe(403);
  }
  for (const path of ["/v1/chat/completions", "/api/v1/responses", "/v1/messages", "/responses", "/codex/responses", "/v1beta/models/gemini:generateContent"]) {
    expect(await call(path)).toBeNull();
  }
  expect((await call("/v1beta/models/gemini:generateContent", true)).status).toBe(403);
  configure("none");
  expect(await call("/v1/images/generations")).toBeNull();
});

it("does not admit revoked, paused or deleted keys even during a retry", async () => {
  configure();
  raw.exec("UPDATE apiKeys SET isActive = 0");
  await expect(reserveTokens("synthetic-key", 10, 10)).rejects.toMatchObject({ status: 401 });
  raw.exec("DELETE FROM apiKeys");
  await expect(reserveTokens("synthetic-key", 10, 10)).rejects.toMatchObject({ status: 401 });
});

it("excludes the context buffer from estimated token charges", async () => {
  configure();
  const body = { messages: [], max_tokens: 100 };
  await withTokenBudget({ apiKey: "synthetic-key", body }, async o => {
    o.tokenBudgetAttempt.markStarted();
    o.onTokenUsage({ prompt_tokens: 2010, completion_tokens: 20 }, true);
    return { success: true, response: Response.json({ ok: true }) };
  });
  expect((await getTokenBudget("K")).used).toBe(Math.ceil(JSON.stringify(body).length / 4) + 20);
});

it("atomically holds concurrent requests, then charges exact usage once", async () => {
  configure();
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => reserveTokens("synthetic-key", 100, 500, now)));
  const accepted = results.filter(r => r.status === "fulfilled").map(r => r.value);
  expect(accepted.map(r => r.amount)).toEqual([600, 400]);
  expect(results.filter(r => r.status === "rejected")).toHaveLength(8);
  expect((await getTokenBudget("K", now)).remaining).toBe(0);
  await settleTokens(accepted[0].id, 150, "actual", now);
  await settleTokens(accepted[0].id, 150, "actual", now);
  await settleTokens(accepted[1].id, 0, "released", now);
  expect(await getTokenBudget("K", now)).toMatchObject({ used: 150, remaining: 850, reserved: 0 });
});

it("records an upstream overrun in full and blocks the next request", async () => {
  configure("lifetime", 100);
  const hold = await reserveTokens("synthetic-key", 20, 80);
  await settleTokens(hold.id, 160);
  expect(await getTokenBudget("K")).toMatchObject({ used: 160, remaining: 0 });
  await expect(reserveTokens("synthetic-key", 1, 1)).rejects.toMatchObject({ status: 429 });
  await addTokenBudget("K", 100);
  expect((await getTokenBudget("K")).remaining).toBe(40);
});

it("keeps state through key replacement, unrelated edits and cycle changes", async () => {
  configure();
  const hold = await reserveTokens("synthetic-key", 100, 100, now);
  await settleTokens(hold.id, 120, "actual", now);
  await updateApiKey("K", { key: "rotated-key", name: "Renamed" });
  configure("monthly", 2000);
  expect(await getTokenBudget("K", now)).toMatchObject({ used: 120, remaining: 1880 });
  configure("none"); configure("lifetime", 3000);
  expect((await getTokenBudget("K", now)).used).toBe(120);
});

it("top-ups apply to the current period and monthly reset does not carry leftovers", async () => {
  configure("monthly");
  await addTokenBudget("K", 200, now);
  const hold = await reserveTokens("synthetic-key", 100, 100, now);
  await settleTokens(hold.id, 150, "actual", now);
  expect(await getTokenBudget("K", now)).toMatchObject({ total: 1200, used: 150, remaining: 1050, resetAt: "2026-11-01T00:00:00.000Z" });
  expect(await getTokenBudget("K", Date.parse("2026-12-07T00:00:00Z"))).toMatchObject({ total: 1000, used: 0, extra: 0, resetAt: "2027-01-01T00:00:00.000Z" });
});

it("a stream crossing a reset is charged to its original period", async () => {
  configure("monthly");
  const hold = await reserveTokens("synthetic-key", 100, 100, now);
  await settleTokens(hold.id, 150, "actual", Date.parse("2026-11-01T00:01:00Z"));
  expect((await getTokenBudget("K", Date.parse("2026-11-01T00:02:00Z")))).toMatchObject({ used: 0, remaining: 1000 });
});

it("recovers abandoned holds conservatively and reconciles late usage once", async () => {
  configure();
  const hold = await reserveTokens("synthetic-key", 100, 200, now);
  const later = now + 3 * 60 * 60 * 1000;
  expect(await getTokenBudget("K", later)).toMatchObject({ used: 300, reserved: 0 });
  await settleTokens(hold.id, 120, "actual", later);
  await settleTokens(hold.id, 120, "actual", later);
  expect(await getTokenBudget("K", later)).toMatchObject({ used: 120, remaining: 880 });
});

it("rejects cycle changes with a live hold and malformed stored state", async () => {
  configure();
  await reserveTokens("synthetic-key", 100, 100, now);
  expect(() => configure("monthly")).toThrow(/active requests/);
  raw.exec("UPDATE apiKeys SET tokenBudget = 'broken'");
  await expect(reserveTokens("synthetic-key", 10, 10, now)).rejects.toThrow();
});

it("serves customer token balances without requesting subscription details", async () => {
  configure();
  const key = await getApiKeyById("K");
  const quota = await getCustomerQuota(key);
  expect(quota).toMatchObject({ kind: "token_allowance", status: "available", accounts: [{ limits: [{ unit: "tokens", total: 1000, remaining: 1000, resetAt: null }] }] });
  expect(readProviderUsage).not.toHaveBeenCalled();
});

it("validates dashboard edits and top-ups while preserving account access", async () => {
  const request = body => new Request("http://localhost/api/keys/K", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const params = { params: Promise.resolve({ id: "K" }) };
  expect((await PUT(request({ tokenBudget: { mode: "lifetime", limit: -1 } }), params)).status).toBe(400);
  expect((await PUT(request({ tokenBudget: { mode: "lifetime", limit: 1000 } }), params)).status).toBe(200);
  expect((await topUp(request({ amount: 200 }), params)).status).toBe(200);
  expect((await getTokenBudget("K")).remaining).toBe(1200);
  expect((await topUp(request({ amount: 0 }), params)).status).toBe(400);
});

it("clamps output, settles canonical cache-inclusive usage, and rejects exhausted requests before upstream", async () => {
  configure("lifetime", 200);
  const call = vi.fn(async options => {
    expect(options.body.max_tokens).toBeLessThan(500);
    options.tokenBudgetAttempt.markStarted();
    options.onTokenUsage({ input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 30, output_tokens: 60 });
    return { success: true, response: Response.json({ ok: true }) };
  });
  const options = { apiKey: "synthetic-key", body: { messages: [{ role: "user", content: "hello" }], max_tokens: 500 } };
  expect((await withTokenBudget(options, call)).success).toBe(true);
  expect((await getTokenBudget("K")).used).toBe(200);
  const denied = await withTokenBudget(options, call);
  expect(denied).toMatchObject({ budgetDenied: true, status: 429 });
  expect(call).toHaveBeenCalledTimes(1);
});

it("releases definite provider rejection, but keeps a disconnected attempt estimated", async () => {
  configure();
  const options = { apiKey: "synthetic-key", body: { messages: [], max_tokens: 100 } };
  await withTokenBudget(options, async o => { o.tokenBudgetAttempt.markStarted(); return { success: false, status: 429, response: new Response(null, { status: 429 }) }; });
  expect((await getTokenBudget("K")).used).toBe(0);
  const response = await withTokenBudget(options, async o => {
    o.tokenBudgetAttempt.markStarted();
    return { success: true, response: new Response(new ReadableStream({ pull() {} }), { headers: { "Content-Type": "text/event-stream" } }) };
  });
  await response.response.body.cancel();
  expect((await getTokenBudget("K")).used).toBeGreaterThan(100);
  expect((await getTokenBudget("K")).reserved).toBe(0);
});

it("awaits streamed usage and never adds reasoning/cache subsets twice", async () => {
  configure();
  const response = await withTokenBudget({ apiKey: "synthetic-key", body: { messages: [], max_tokens: 100 } }, async o => {
    o.tokenBudgetAttempt.markStarted();
    return { success: true, response: new Response(new ReadableStream({ start(controller) {
      o.onTokenUsage({ prompt_tokens: 100, completion_tokens: 50, cached_tokens: 80, reasoning_tokens: 30 });
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); controller.close();
    } }), { headers: { "Content-Type": "text/event-stream" } }) };
  });
  await response.response.text();
  expect(await getTokenBudget("K")).toMatchObject({ used: 150, remaining: 850, reserved: 0 });
});
