import type { Metadata } from "next";
import { Playfair_Display } from "next/font/google";
import "./globals.css";
import { dirFor } from "@/lib/i18n/config";
import { getPreferences } from "@/lib/i18n/server";

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-playfair",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Aspects Clinica CRM",
  description: "Lead management, conversations, booking sync & auditing for Aspects Clinica.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { locale, theme } = await getPreferences();
  return (
    <html lang={locale} dir={dirFor(locale)} data-theme={theme}>
      <body className={playfair.variable}>{children}</body>
    </html>
  );
}
