import { Suspense } from "react";
import { Account } from "./account";
import "../billing.css";
export const metadata = { title: "Account & credits — Fakeipedia", robots: { index: false, follow: false } };
export default function AccountPage() { return <Suspense fallback={<main className="billing-page">Loading your account…</main>}><Account /></Suspense>; }
