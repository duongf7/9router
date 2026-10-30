import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { keyAccessFromColumns, keyAccessToColumns } from "@/shared/utils/keyAccess.js";
import { KEY_ACCESS_UNRESTRICTED } from "@/shared/constants/keyAccess.js";
import { connectionAccessFromColumns, connectionAccessToColumns } from "@/shared/utils/connectionAccess.js";
import { parseTokenBudget } from "@/shared/utils/tokenBudget.js";
import { configureTokenBudget, getTokenBudget } from "./tokenBudgetRepo.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    access: keyAccessFromColumns(row.accessRestricted, row.accessAllow),
    connectionAccess: connectionAccessFromColumns(row.connectionAccessRestricted, row.connectionAccessAllow),
    tokenBudget: parseTokenBudget(row.tokenBudget) || { mode: "none" },
  };
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return Promise.all(rows.map(async row => ({ ...rowToKey(row), tokenBudget: await getTokenBudget(row.id) })));
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

// Used by the /v1 handlers to read the presented key's access settings.
export async function getApiKeyByKey(key) {
  if (!key) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId, connectionAccess = { restricted: true, allow: [] }, tokenBudget) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
    access: { restricted: false, allow: [] },
    connectionAccess,
  };
  const cols = keyAccessToColumns(KEY_ACCESS_UNRESTRICTED);
  const connCols = connectionAccessToColumns(connectionAccess);
  db.transaction(() => {
    db.run(
      `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, accessRestricted, accessAllow, connectionAccessRestricted, connectionAccessAllow) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt, cols.accessRestricted, cols.accessAllow, connCols.connectionAccessRestricted, connCols.connectionAccessAllow]
    );
    if (tokenBudget !== undefined) configureTokenBudget(db, apiKey.id, tokenBudget);
  });
  return { ...apiKey, tokenBudget: await getTokenBudget(apiKey.id) };
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToKey(row), ...data };
    const cols = keyAccessToColumns(merged.access);
    const connCols = connectionAccessToColumns(merged.connectionAccess);
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, accessRestricted = ?, accessAllow = ?, connectionAccessRestricted = ?, connectionAccessAllow = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, cols.accessRestricted, cols.accessAllow, connCols.connectionAccessRestricted, connCols.connectionAccessAllow, id]
    );
    if (data.tokenBudget !== undefined) configureTokenBudget(db, id, data.tokenBudget);
    result = rowToKey(db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]));
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  return db.transaction(() => {
    db.run("DELETE FROM tokenReservations WHERE keyId = ?", [id]);
    const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
    return (res?.changes ?? 0) > 0;
  });
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT isActive FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  return row.isActive === 1 || row.isActive === true;
}
