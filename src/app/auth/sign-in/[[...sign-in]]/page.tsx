import { AuthScreen, type AuthSearchParams } from "../../auth-screen";

export const metadata = { title: "Sign in — Fakeipedia", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default function SignInPage({ searchParams }: { searchParams: AuthSearchParams }) {
  return <AuthScreen mode="sign-in" searchParams={searchParams} />;
}
