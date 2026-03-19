import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Explore the Fruit Heights City Plan",
  description: "Chat with the Fruit Heights General Plan using grounded citations.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
