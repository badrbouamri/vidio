import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  // M8.1: enables next/navigation's forbidden()/unauthorized() for the
  // admin-only restricted access check.
  experimental: {
    authInterrupts: true,
  },
};

export default nextConfig;
