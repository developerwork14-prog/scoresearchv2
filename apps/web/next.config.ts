import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  // Keep generated files out of the OneDrive-synced source tree on Windows.
  // This location still keeps Node's normal dependency resolution intact.
  distDir: "node_modules/.next-cache"
};

export default nextConfig;
