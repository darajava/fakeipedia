import type { Metadata } from "next";
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
  title: "Fakeipedia — Choose a world",
  description: "Explore encyclopedias of imaginary worlds and alternate histories.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable}`}>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
