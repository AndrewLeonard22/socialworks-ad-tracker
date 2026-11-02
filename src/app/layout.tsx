import type { Metadata } from "next";
import { Urbanist } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import "./globals.css";
import "./tracker.css";

/* Proto loads Urbanist 200–600; keep the same axis so light weights match. */
const urbanist = Urbanist({
  variable: "--font-urbanist",
  subsets: ["latin"],
  weight: ["200", "300", "400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Ad Tracker | SocialWorks Pro",
  description: "Meta ad results across every SocialWorks client",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${urbanist.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="h-full bg-swa-frame text-text-primary font-sans" suppressHydrationWarning>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
