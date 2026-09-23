"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { billingFetch } from "./billing-client";

export function PublicHandleForm({ initialHandle, returnPath }: { initialHandle: string | null; returnPath?: string }) {
  const router = useRouter();
  const id = useId();
  const [handle, setHandle] = useState(initialHandle ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const submitting = useRef(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setError(""); setSaved(false);
    try {
      const result = await billingFetch<{ handle: string | null }>("/api/account/profile", { handle });
      setHandle(result.handle ?? "");
      setSaved(true);
      if (returnPath) router.replace(returnPath);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save your name or handle. Please try again.");
    } finally { submitting.current = false; setBusy(false); }
  }

  return <form className="public-handle-form" onSubmit={save}>
    <label htmlFor={id}>Name or handle (optional)</label>
    <input id={id} name="handle" autoComplete="nickname" value={handle} maxLength={50} disabled={busy}
      aria-describedby={`${id}-help`} onChange={(event) => { setHandle(event.target.value); setSaved(false); }} />
    <p id={`${id}-help`} className="billing-muted">This will appear publicly beside your contributions in Discussion. You can edit it any time in your account. Leave it blank to appear as Anonymous reader.</p>
    {error && <p role="alert" className="billing-error">{error}</p>}
    {saved && !returnPath && <p role="status">Saved. Your Discussion contributions now use this name or handle.</p>}
    <div className="public-handle-actions">
      <button disabled={busy} type="submit">{busy ? "Saving…" : returnPath ? "Continue" : "Save name or handle"}</button>
      {returnPath && !busy && <Link href={returnPath}>Skip for now</Link>}
    </div>
  </form>;
}
