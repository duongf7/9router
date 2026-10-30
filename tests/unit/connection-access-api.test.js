import { beforeEach, expect, it, vi } from "vitest";
const fx = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/db/repos/tokenBudgetRepo.js", () => ({ getTokenBudget: async () => ({ mode: "none" }), TokenBudgetError: class extends Error {} }));
vi.mock("@/lib/localDb", () => ({
  getApiKeys: async () => [], deleteApiKey: vi.fn(),
  getApiKeyById: async () => ({ id: "key" }),
  createApiKey: fx.create, updateApiKey: fx.update,
}));
vi.mock("@/lib/db/repos/connectionsRepo.js", () => ({ getProviderConnections: async () => [{ id: "A" }] }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: async () => "test-machine" }));
const createRoute = await import("@/app/api/keys/route.js");
const updateRoute = await import("@/app/api/keys/[id]/route.js");
const req = body => new Request("http://localhost/api/keys", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); fx.create.mockResolvedValue({ id: "key", key: "test" }); fx.update.mockResolvedValue({ id: "key" }); });

it("new keys default to no assigned accounts and can be assigned atomically at creation", async () => {
  expect((await createRoute.POST(req({ name: "customer" }))).status).toBe(201);
  expect(fx.create).toHaveBeenLastCalledWith("customer", "test-machine", { restricted: true, allow: [] }, undefined);
  const connectionAccess = { restricted: true, allow: ["A"] };
  expect((await createRoute.POST(req({ name: "customer", connectionAccess }))).status).toBe(201);
  expect(fx.create).toHaveBeenLastCalledWith("customer", "test-machine", connectionAccess, undefined);
});
it.each([null, { restricted: "false", allow: [] }, { restricted: true, allow: ["missing"] }, { restricted: true, allow: [123] }])("rejects malformed or missing assignments on create and edit", async connectionAccess => {
  expect((await createRoute.POST(req({ name: "customer", connectionAccess }))).status).toBe(400);
  expect((await updateRoute.PUT(req({ connectionAccess }), { params: Promise.resolve({ id: "key" }) })).status).toBe(400);
  expect(fx.create).not.toHaveBeenCalled();
  expect(fx.update).not.toHaveBeenCalled();
});
it("allows an explicit unrestricted admin key", async () => {
  expect((await createRoute.POST(req({ name: "admin", connectionAccess: { restricted: false, allow: [] } }))).status).toBe(201);
  expect(fx.create).toHaveBeenLastCalledWith("admin", "test-machine", { restricted: false, allow: [] }, undefined);
});
