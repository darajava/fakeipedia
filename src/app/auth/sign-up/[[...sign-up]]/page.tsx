import { AuthScreen, type AuthSearchParams } from "../../auth-screen";

export const metadata = { title: "Create an account — Fakeipedia", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default function SignUpPage({ searchParams }: { searchParams: AuthSearchParams }) {
  return <AuthScreen mode="sign-up" searchParams={searchParams} />;
}
