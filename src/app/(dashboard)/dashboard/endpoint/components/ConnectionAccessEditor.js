"use client";

import { useEffect, useState } from "react";

export default function ConnectionAccessEditor({ value, onChange }) {
  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    fetch("/api/providers", { cache: "no-store" })
      .then(async res => {
        if (!res.ok) throw new Error("Could not load accounts. Close and reopen to retry.");
        const data = await res.json();
        if (live) setAccounts(data.connections || []);
      })
      .catch(err => { if (live) setError(err.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const missing = value.allow.filter(id => !accounts.some(account => account.id === id));
  const toggle = id => onChange({ restricted: true, allow: value.allow.includes(id)
    ? value.allow.filter(item => item !== id) : [...value.allow, id] });

  return <div className="space-y-2" data-testid="connection-access-editor">
    <label className="block text-sm font-medium" htmlFor="account-scope">Account access</label>
    <select id="account-scope" className="w-full rounded border p-2 bg-bg text-text-main" value={value.restricted ? "assigned" : "all"}
      onChange={e => onChange({ restricted: e.target.value === "assigned", allow: [] })}>
      <option value="assigned">Assigned accounts only</option>
      <option value="all">All accounts (including accounts added later)</option>
    </select>
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {value.restricted ? <>
      <div className="max-h-64 overflow-auto space-y-1">
        {loading && <p className="text-sm text-text-muted">Loading accounts…</p>}
        {accounts.map(account => <label key={account.id} className="flex items-center gap-2 text-sm py-1">
          <input type="checkbox" checked={value.allow.includes(account.id)} onChange={() => toggle(account.id)} />
          <span>{account.provider} · {account.name || account.email || account.id}{account.isActive === false ? " (paused)" : ""}</span>
        </label>)}
        {!loading && missing.map(id => <label key={id} className="flex items-center gap-2 text-sm text-orange-500">
          <input type="checkbox" checked onChange={() => toggle(id)} />Removed account ({id})
        </label>)}
      </div>
      <p className="text-xs text-text-muted">Retries stay within these accounts. {value.allow.length === 0 ? "No account selected: requests will be blocked." : "Accounts shared with another key share the same subscription quota."}</p>
    </> : <p className="text-xs text-orange-500">This key can use every account. Choose assigned accounts to isolate a customer.</p>}
  </div>;
}
