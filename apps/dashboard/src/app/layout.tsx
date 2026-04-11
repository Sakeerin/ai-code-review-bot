import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Code Review Bot Dashboard",
  description: "Manage your GitHub App and settings.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
