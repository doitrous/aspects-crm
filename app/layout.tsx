import type { Metadata } from "next";
import "./globals.css";
import { dirFor } from "@/lib/i18n/config";
import { getPreferences } from "@/lib/i18n/server";

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
      <body>{children}</body>
    </html>
  );
}
