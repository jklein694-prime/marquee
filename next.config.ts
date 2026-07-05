import type { NextConfig } from "next";

// Pin Turbopack's workspace root to this project. Without it, Next infers the root
// from the nearest lockfile — which misfires if a stray package-lock.json exists in
// a parent/home dir, corrupting the module manifest. __dirname is portable (unlike a
// hardcoded absolute path), so this works for any clone. See Next docs: turbopack#root.
const nextConfig: NextConfig = {
  turbopack: { root: __dirname },
};

export default nextConfig;
