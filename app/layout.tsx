import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Explore the Fruit Heights City Plan",
  description: "Chat with the Fruit Heights General Plan using grounded citations.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const gaId = "G-BVZ87YNW63";
  return (
    <html lang="en">
      <head>
        <Script src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`} strategy="afterInteractive" />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${gaId}');
          `}
        </Script>
      </head>
      <body>{children}</body>
    </html>
  );
}
