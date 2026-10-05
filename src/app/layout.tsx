import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Millionaire Trading Journal", template: "%s · MTJ" },
  description: "Trading journal and personal performance coach.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: "#0b0d10", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
