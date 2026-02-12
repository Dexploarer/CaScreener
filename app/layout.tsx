import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CaScreener | Memecoin Intelligence OS",
  description:
    "Real-time memecoin intelligence: clone detection, trust scoring, narrative radar, and viral share packs.",
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
  openGraph: {
    title: "CaScreener | Memecoin Intelligence OS",
    description: "Scan, score, and share memecoin alpha with high-fidelity visual intelligence.",
    images: ["/logo.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
        {children}
      </body>
    </html>
  );
}
