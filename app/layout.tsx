import type { Metadata, Viewport } from "next";
import { LanguageProvider } from "@/lib/language-provider";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "EXPERT EXPRESS SENDER CO., LTD",
  title: "EXPERT EXPRESS SENDER CO., LTD",
  description: "Fuel log and bank transfer management for logistics teams.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }]
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "EXPERT EXPRESS"
  },
  formatDetection: {
    telephone: false
  }
};

export const viewport: Viewport = {
  themeColor: "#020617",
  colorScheme: "light"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
