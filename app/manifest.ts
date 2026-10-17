import type { MetadataRoute } from "next";

// Installable home-screen app (iOS needs the site on HTTPS — see the Tailscale
// note in jetson/README.md). Standalone display drops the Safari chrome.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Marquee",
    short_name: "Marquee",
    description: "Personal movie & TV expert with a living taste graph",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0c0a08",
    theme_color: "#0c0a08",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
