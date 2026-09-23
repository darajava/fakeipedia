import { Suspense } from "react";
import { Payment } from "./payment";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { PaymentLoading } from "./payment-loading";
import "../billing.css";
export const metadata = { title: "Generate an article — Fakeipedia", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default function PaymentPage() {
  return <main className="billing-page payment-page">
    <nav className="billing-nav"><Link href="/">Fakeipedia</Link><ThemeToggle /></nav>
    <Suspense fallback={<PaymentLoading />}><Payment /></Suspense>
  </main>;
}
