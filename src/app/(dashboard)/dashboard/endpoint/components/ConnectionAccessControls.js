"use client";

import { useState } from "react";
import { Button, Modal } from "@/shared/components";
import ConnectionAccessEditor from "./ConnectionAccessEditor";

export default function ConnectionAccessControls({ apiKey, onSave }) {
  const access = apiKey.connectionAccess || { restricted: false, allow: [] };
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setSaving(true);
    setError("");
    try { await onSave(draft); setDraft(null); }
    catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };
  return <div className="mt-2">
    <button className="text-xs text-primary underline" onClick={() => { setError(""); setDraft(access); }}>
      {access.restricted ? `${access.allow.length} assigned account(s)` : "All accounts · unrestricted"} · Edit
    </button>
    {draft && <Modal isOpen title={`Accounts for ${apiKey.name}`} onClose={() => { if (!saving) setDraft(null); }}>
      <div className="space-y-4">
        <fieldset disabled={saving}><ConnectionAccessEditor value={draft} onChange={setDraft} /></fieldset>
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
        <Button onClick={save} disabled={saving} fullWidth>{saving ? "Saving…" : "Save account access"}</Button>
      </div>
    </Modal>}
  </div>;
}
