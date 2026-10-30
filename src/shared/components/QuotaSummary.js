"use client";

// Source-independent display contract, also documented for the Revit client.
export default function QuotaSummary({ snapshot }) {
  if (!snapshot) return null;
  const balance = limit => limit.unlimited ? "Unlimited"
    : limit.remaining != null && limit.unit ? `${limit.remaining.toLocaleString()} ${limit.unit === "currency" ? limit.currency : limit.unit} remaining`
    : limit.remainingPercent == null ? "Unknown" : `${Math.round(limit.remainingPercent)}% remaining`;
  const message = {
    account_assignment_required: "Assign specific accounts to view customer quota.",
    no_assigned_accounts: "No assigned accounts.",
    inactive_key: "This key is paused.",
  }[snapshot.reason];
  return <div className="space-y-2 text-xs" data-testid="quota-summary">
    {message && <p className="text-text-muted">{message}</p>}
    {snapshot.accounts.map((account, index) => <div key={account.id} className="rounded border border-black/10 dark:border-white/10 p-2 space-y-1">
      <p className="font-medium">{account.provider} · Account {index + 1}</p>
      {account.status !== "available" && <p className="text-text-muted">{account.status === "paused" ? "Account paused" : "Quota unavailable"}</p>}
      {account.limits.map(limit => <div key={limit.label}>
        <div className="flex justify-between gap-3"><span>{limit.label}</span><span>{balance(limit)}</span></div>
        {limit.remainingPercent !== null && !limit.unlimited && <progress className="w-full h-1" max="100" value={limit.remainingPercent} aria-label={`${limit.label} remaining`} />}
        {limit.resetAt && <p className="text-text-muted">Resets {new Date(limit.resetAt).toLocaleString()}</p>}
      </div>)}
      {account.updatedAt && <p className="text-text-muted">Updated {new Date(account.updatedAt).toLocaleTimeString()}</p>}
    </div>)}
    {snapshot.accounts.length > 0 && <p className="text-text-muted">Subscription balance includes usage outside this key.</p>}
  </div>;
}
