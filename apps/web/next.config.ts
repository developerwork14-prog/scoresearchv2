import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  // Keep generated files out of the OneDrive-synced source tree on Windows.
  // Vercel requires its normal `.next` directory when collecting deployment files.
  ...(process.env.VERCEL ? {} : { distDir: "node_modules/.next-cache" })
};

export default nextConfig;
