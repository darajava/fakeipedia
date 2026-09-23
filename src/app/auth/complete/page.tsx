import Link from "next/link";
import { redirect } from "next/navigation";
import { PublicHandleForm } from "@/components/public-handle-form";
import { ThemeToggle } from "@/components/theme-toggle";
import { billingUser } from "@/lib/billing/auth";
import { authPagePath, authReturnPath } from "@/lib/auth-navigation";
import "../../billing.css";

export const metadata = { title: "Your public name — Fakeipedia", robots: { index: false, follow: false } };

export default async function CompleteSignup({ searchParams }: { searchParams: Promise<{ return?: string }> }) {
  const query = await searchParams;
  const returnPath = authReturnPath(query.return, process.env.APP_URL) ?? "/account";
  const user = await billingUser();
  if (!user) redirect(authPagePath("sign-up", returnPath));
  return <main className="billing-page">
    <nav className="billing-nav"><Link href="/">Fakeipedia</Link><ThemeToggle /></nav>
    <h1>What would you like to be called?</h1>
    <PublicHandleForm initialHandle={user.handle} returnPath={returnPath} />
  </main>;
}
