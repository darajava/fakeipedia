"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type BillingResource<T> =
  | { status: "loading" }
  | { status: "error"; error: string; cause: unknown }
  | { status: "ready"; data: T; error?: string };

// Poll sequentially, keep the last successful view on transient failures, and
// prevent an older request (or an unmounted page) from replacing newer data.
export function useBillingResource<T>(load: () => Promise<T>, interval: number, failureMessage: string) {
  const [state, setState] = useState<BillingResource<T>>({ status: "loading" });
  const mounted = useRef(false);
  const latestRequest = useRef<object | null>(null);

  const refresh = useCallback(async () => {
    const request = {};
    latestRequest.current = request;
    if (mounted.current) setState((previous) => previous.status === "ready" ? previous : { status: "loading" });
    try {
      const data = await load();
      if (mounted.current && request === latestRequest.current) setState({ status: "ready", data });
      return data;
    } catch (failure) {
      if (mounted.current && request === latestRequest.current) {
        const error = failure instanceof Error ? failure.message : failureMessage;
        setState((previous) => previous.status === "ready"
          ? { ...previous, error }
          : { status: "error", error, cause: failure });
      }
      throw failure;
    }
  }, [load, failureMessage]);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      let delay = interval;
      try { await refresh(); } catch { delay = 10000; }
      if (!cancelled) timer = setTimeout(poll, delay);
    }
    void poll();
    return () => {
      cancelled = true;
      mounted.current = false;
      latestRequest.current = null;
      clearTimeout(timer);
    };
  }, [refresh, interval]);

  const retry = useCallback(() => { void refresh().catch(() => {}); }, [refresh]);
  return { state, refresh, retry };
}
