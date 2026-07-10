import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Intent quote demo",
  description:
    "Small internal app for exercising the middleware intent quote flow",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
