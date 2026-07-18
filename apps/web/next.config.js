/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static export keeps the web app deployable from the API process
  // (single-origin) or any static host. Toggle off if you add SSR later.
  output: "export",
  images: { unoptimized: true },
};

module.exports = nextConfig;
