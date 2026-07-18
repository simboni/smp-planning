import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StackUp",
  description: "One app to plan, track, and get work done.",
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
  themeColor: "#7B68EE",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
