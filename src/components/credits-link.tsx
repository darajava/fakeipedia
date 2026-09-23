"use client";

import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { billingFetch } from "./billing-client";

export function CreditsLink() {
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <SignedInCreditsLink /> : null;
}

function SignedInCreditsLink() {
  const { isSignedIn, userId } = useAuth();
  const pathname = usePathname();
  const [balance, setBalance] = useState<{ userId: string; available: number }>();
  useEffect(() => {
    if (!isSignedIn || !userId) return;
    let active = true;
    const refresh = async () => {
      try {
        const result = await billingFetch<{ signedIn: boolean; available?: number }>("/api/billing/balance");
        if (active) setBalance(result.signedIn ? { userId, available: result.available ?? 0 } : undefined);
      } catch { /* Keep the last known balance during a temporary interruption. */ }
    };
    void refresh();
    const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    window.addEventListener("fakeipedia:credits-changed", refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener("fakeipedia:credits-changed", refresh); };
  }, [isSignedIn, userId, pathname]);
  if (!isSignedIn || !balance || balance.userId !== userId) return null;
  const label = `${balance.available.toLocaleString()} available ${balance.available === 1 ? "credit" : "credits"} — Account and credits`;
  return <Link href="/account" className="credits-link" aria-label={label} title={label}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <ellipse cx="10" cy="7" rx="7" ry="3" /><path d="M3 7v5c0 1.7 3.1 3 7 3m7-8v4M3 12v5c0 1.7 3.1 3 7 3" /><circle cx="17" cy="17" r="5" />
    </svg>
    <span>{balance.available.toLocaleString()}</span>
  </Link>;
}
