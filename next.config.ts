import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Allow isolated production builds (desktop packaging) without
  // clobbering the sandbox dev server's .next directory.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: ["*.space-z.ai", "*.chat.z.ai"],
};

export default nextConfig;
