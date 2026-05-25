import type { Metadata } from "next";
import { Newsreader, Public_Sans } from "next/font/google";

import { ToasterProvider } from "@/components/ui/toaster-provider";

import "./globals.css";

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "VoiceCart AI | WhatsApp Voice Commerce",
  description:
    "Bot ecommerce por WhatsApp con notas de voz, OpenAI, UltraMsg y ElevenLabs.",
  icons: {
    icon: "/icon.png",
    shortcut: "/icon.png",
    apple: "/icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${publicSans.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body
        suppressHydrationWarning
        className="min-h-full flex flex-col bg-background text-foreground"
      >
        {children}
        <ToasterProvider />
      </body>
    </html>
  );
}
