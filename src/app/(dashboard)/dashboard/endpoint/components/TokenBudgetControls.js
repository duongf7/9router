"use client";

import { useState } from "react";
import { Button, Modal } from "@/shared/components";
import TokenBudgetEditor from "./TokenBudgetEditor";
import { validateTokenBudget } from "@/shared/utils/tokenBudget.js";

export default function TokenBudgetControls({ apiKey, onUpdate }) {
  const budget = apiKey.tokenBudget || { mode: "none" };
  const [draft, setDraft] = useState(null);
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = budget.mode !== "none";
  const number = value => (value || 0).toLocaleString();
  const save = async () => {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/keys/${apiKey.id}${adding ? "/tokens" : ""}`, {
        method: adding ? "POST" : "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(adding ? { amount } : { tokenBudget: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save token allowance.");
      onUpdate(data.key || { ...apiKey, tokenBudget: data.tokenBudget });
      setDraft(null); setAdding(false);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return <div className="mt-2 space-y-1" data-testid="token-budget">
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      <button className="text-primary underline" onClick={() => { setError(""); setDraft({ mode: budget.mode, limit: budget.limit || 0 }); }}>
        {active ? `${number(budget.remaining)} / ${number(budget.total)} tokens remaining` : "No token limit"} · Edit
      </button>
      {active && <button className="text-primary underline" onClick={() => { setError(""); setAmount(0); setAdding(true); }}>Add tokens</button>}
    </div>
    {active && <p className="text-xs text-text-muted">Used {number(budget.used)}{budget.resetAt ? ` · Resets ${new Date(budget.resetAt).toLocaleString()}` : ""}</p>}
    {(draft || adding) && <Modal isOpen title={`${adding ? "Add tokens" : "Token allowance"} · ${apiKey.name}`}
      onClose={() => { if (!busy) { setDraft(null); setAdding(false); } }}>
      <div className="space-y-4">
        <fieldset disabled={busy}>
          {adding ? <label className="block text-sm">Tokens to add
            <input type="number" min="1" step="1" value={amount || ""} onChange={e => setAmount(Number(e.target.value))}
              className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent p-2" />
          </label> : <TokenBudgetEditor value={draft} onChange={setDraft} />}
        </fieldset>
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
        <Button fullWidth onClick={save} disabled={busy || (adding ? !Number.isSafeInteger(amount) || amount <= 0 : !validateTokenBudget(draft).ok)}>
          {busy ? "Saving…" : adding ? "Add tokens" : "Save allowance"}
        </Button>
      </div>
    </Modal>}
  </div>;
}
