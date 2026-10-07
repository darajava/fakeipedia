import { Suspense } from "react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import styles from "@/app/billing.module.css";
import { Payment } from "./payment";
import { PaymentLoading } from "./payment-loading";

export const metadata = {
  title: "Generate an article — Fakeipedia",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

export default function PaymentPage() {
  return <main className={[styles.billingPage, styles.paymentPage].join(" ")}>
    <nav className={styles.billingNav}>
      <Link href="/">Fakeipedia</Link>
      <ThemeToggle />
    </nav>
    <Suspense fallback={<PaymentLoading />}>
      <Payment />
    </Suspense>
  </main>;
}
