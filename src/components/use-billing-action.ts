"use client";

import { useEffect, useRef, useState } from "react";

// All purchase actions share the same double-submit guard and error behaviour.
export function useBillingAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function run(action: (isActive: () => boolean) => Promise<void>, failureMessage: string) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await action(() => mounted.current);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : failureMessage);
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return { busy, error, run };
}
