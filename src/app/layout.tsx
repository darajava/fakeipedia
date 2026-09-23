import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Run before the page paints so a saved preference never flashes the other theme.
const themeScript = `(() => {
  let theme;
  try { theme = localStorage.getItem("fakeipedia-theme"); } catch {}
  document.documentElement.dataset.theme = theme === "light" || theme === "dark"
    ? theme : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
})();`;

export const metadata: Metadata = {
  title: "Fakeipedia — Choose a Wiki",
  description: "An encyclopedia of different worlds. Explore the histories, people, and peculiarities of an alternate reality.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable}`}>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>{process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <ClerkProvider signInUrl="/auth/sign-in" signUpUrl="/auth/sign-up" signInFallbackRedirectUrl="/account" signUpFallbackRedirectUrl="/account">{children}</ClerkProvider> : children}</body>
    </html>
  );
}
