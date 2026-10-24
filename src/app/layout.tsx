import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";

// Latin text uses Inter; Hindi (Devanagari) remarks fall through to Noto Sans Devanagari,
// then to the phone's own Devanagari font (see --font-sans in globals.css).
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const devanagari = Noto_Sans_Devanagari({ subsets: ["devanagari"], variable: "--font-devanagari", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Branch Review OS", template: "%s · Branch Review OS" },
  description: "Lead-centric sales review for the branch.",
  appleWebApp: { capable: true, title: "Branch Review", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f766e",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${devanagari.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
