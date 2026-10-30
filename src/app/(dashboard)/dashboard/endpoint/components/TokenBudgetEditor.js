"use client";

import { useId } from "react";

export default function TokenBudgetEditor({ value, onChange }) {
  const id = useId();
  return <div className="space-y-3">
    <div>
      <label className="block text-sm" htmlFor={`${id}-cycle`}>Token allowance</label>
      <select className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent p-2"
        id={`${id}-cycle`} value={value.mode} onChange={e => onChange({ ...value, mode: e.target.value })}>
        <option value="none">No token limit</option>
        <option value="monthly">Monthly</option>
        <option value="lifetime">Until used up</option>
      </select>
    </div>
    {value.mode !== "none" && <label className="block text-sm">Tokens
      <input className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent p-2"
        type="number" min="1" step="1" value={value.limit || ""} placeholder="1000000"
        onChange={e => onChange({ ...value, limit: Number(e.target.value) })} />
    </label>}
    {value.mode === "monthly" && <p className="text-xs text-text-muted">Resets on the 1st of each month at 00:00 UTC. Unused and added tokens do not carry over.</p>}
  </div>;
}
