import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

export const metadata: Metadata = {
  // Absolute base for social-card URLs. og:image MUST be absolute for
  // WhatsApp/Facebook/Slack; the canonical host serves the image no matter
  // which origin the page itself was loaded from.
  metadataBase: new URL("https://www.stackup.co.ke"),
  title: "StackUp",
  description: "One app to plan, track, and get work done.",
  openGraph: {
    type: "website",
    siteName: "StackUp",
    title: "StackUp",
    description: "One app to plan, track, and get work done.",
    images: [{ url: "/og-share.png", width: 1200, height: 630, alt: "StackUp" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "StackUp",
    description: "One app to plan, track, and get work done.",
    images: ["/og-share.png"],
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "StackUp" },
  icons: {
    icon: [
      {
        url:
          "data:image/svg+xml," +
          encodeURIComponent(
            `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%237B68EE'/><g fill='none' stroke='white' stroke-width='2.2' stroke-linejoin='round'><path d='M16 6 25 10.5 16 15 7 10.5z'/><path d='M7 15.5 16 20 25 15.5'/><path d='M7 20.5 16 25 25 20.5'/></g></svg>`,
          ),
      },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#7B68EE",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {/* Set the theme before first paint to avoid a light-mode flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('stackup.theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();",
          }}
        />
        {/* Mark the document early when running inside the Capacitor shell so
            CSS can swap the desktop chrome for the mobile app shell. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{if(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform()){document.documentElement.setAttribute('data-app','native');}}catch(e){}})();",
          }}
        />
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
