import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import PwaRegister from "@/components/PwaRegister";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Marquee",
  description: "Personal movie & TV expert with a living taste graph",
  // iOS home-screen app: full screen, solid dark status bar (content stays below the notch)
  appleWebApp: { capable: true, title: "Marquee", statusBarStyle: "black" },
};

// viewport-fit: cover surfaces the notch/home-indicator safe-area insets so the
// mobile bottom nav and chat input can pad around them; theme-color tints the
// mobile browser chrome to match the dark-warm theater background.
export const viewport: Viewport = {
  themeColor: "#0c0a08",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <PwaRegister />
        <div className="vignette" />
      </body>
    </html>
  );
}
