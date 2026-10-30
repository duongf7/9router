"use client";

import { useState } from "react";
import QuotaSummary from "@/shared/components/QuotaSummary";

export default function KeyQuota({ keyId }) {
  const [snapshot, setSnapshot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/keys/${keyId}/quota`, { cache: "no-store" });
      if (!response.ok) throw new Error("Quota temporarily unavailable.");
      setSnapshot(await response.json());
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return <div className="mt-2 space-y-2">
    <button className="text-xs text-primary underline" disabled={busy} onClick={load}>{busy ? "Loading quota…" : snapshot ? "Refresh quota" : "View quota"}</button>
    {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
    <QuotaSummary snapshot={snapshot} />
  </div>;
}
