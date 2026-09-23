import Link from "next/link";
import { SignIn, SignUp } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { authPagePath, authReturnPath, signupCompletionPath } from "@/lib/auth-navigation";
import "./auth.css";

export type AuthSearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function AuthScreen({ mode, searchParams }: { mode: "sign-up" | "sign-in"; searchParams: AuthSearchParams }) {
  const query = await searchParams;
  const requested = typeof query.return === "string" ? query.return : undefined;
  const returnPath = authReturnPath(requested, process.env.APP_URL) ?? "/account";
  const configured = Boolean(process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  if (configured && (await auth()).userId) redirect(returnPath);
  const appearance = {
    variables: {
      colorPrimary: "var(--wiki-link)",
      colorBackground: "var(--wiki-surface)",
      colorForeground: "var(--wiki-text)",
      colorMutedForeground: "var(--wiki-muted)",
      colorInput: "var(--wiki-background)",
      colorInputForeground: "var(--wiki-text)",
      fontFamily: "Arial, Helvetica, sans-serif",
      borderRadius: "4px",
    },
    elements: {
      rootBox: { width: "100%" },
      cardBox: { width: "100%", boxShadow: "none", border: "1px solid var(--wiki-border-light)" },
      card: { boxShadow: "none" },
      headerTitle: { fontFamily: 'Georgia, "Times New Roman", serif', fontSize: "28px", fontWeight: "normal" },
    },
  };
  return <main className="auth-page">
    <nav className="auth-nav"><Link href="/">Fakeipedia</Link><ThemeToggle /></nav>
    <div className="auth-form">
      {configured ? mode === "sign-up"
        ? <SignUp routing="path" path="/auth/sign-up" signInUrl={authPagePath("sign-in", returnPath)} forceRedirectUrl={signupCompletionPath(returnPath)} signInForceRedirectUrl={returnPath} appearance={appearance} />
        : <SignIn routing="path" path="/auth/sign-in" withSignUp={false} signUpUrl={authPagePath("sign-up", returnPath)} forceRedirectUrl={returnPath} signUpForceRedirectUrl={signupCompletionPath(returnPath)} appearance={appearance} />
        : <p role="alert">Account access is not available yet. Your saved answer is safe.</p>}
    </div>
  </main>;
}
