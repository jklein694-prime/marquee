"use client";

import { useEffect } from "react";

// Registers the service worker (offline shell + push). Browsers only allow it
// on HTTPS or localhost, so on a plain http://<nano-ip> it quietly does nothing.
export default function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
  }, []);
  return null;
}
