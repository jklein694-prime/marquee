"use client";

import { useEffect, useState } from "react";
import { Button } from "./ui";

// "Notify me when a reply finishes in the background." iOS only offers push
// to the home-screen app (Share -> Add to Home Screen) over HTTPS, and only
// asks for permission from a tap — so this is a button, never automatic.

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type State = "unsupported" | "needs-install" | "off" | "on" | "denied" | "working";

export default function PushToggle() {
  const [state, setState] = useState<State>("working");
  const [note, setNote] = useState("");

  useEffect(() => {
    (async () => {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
      if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        setState(ios && !standalone ? "needs-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function turnOn() {
    setState("working");
    setNote("");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setState(perm === "denied" ? "denied" : "off");
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      await navigator.serviceWorker.ready;
      const { publicKey } = await (await fetch("/api/push")).json();
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!res.ok) throw new Error("server rejected the subscription");
      setState("on");
      void fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"test":true}' });
      setNote("Sent a test notification.");
    } catch (err) {
      setState("off");
      setNote(err instanceof Error ? err.message : "Could not turn notifications on.");
    }
  }

  async function turnOff() {
    setState("working");
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
    setState("off");
  }

  const text: Record<State, string> = {
    unsupported: "Notifications need the app opened over HTTPS (see the Nano's Tailscale address).",
    "needs-install": "To get notifications on iPhone: Share -> Add to Home Screen, then open Marquee from there.",
    off: "Get a notification when a reply finishes while Marquee is in the background.",
    on: "Notifications are on for this device.",
    denied: "Notifications are blocked — allow them for Marquee in Settings.",
    working: "…",
  };

  return (
    <div className="rounded-lg border border-border bg-surface-1 px-4 py-3 text-sm">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-fg">Notifications</div>
          <div className="mt-0.5 text-xs text-muted">{text[state]}</div>
          {note && <div className="mt-1 text-xs text-muted">{note}</div>}
        </div>
        {(state === "off" || state === "on") && (
          <Button variant={state === "on" ? "secondary" : "primary"} onClick={state === "on" ? turnOff : turnOn}>
            {state === "on" ? "Turn off" : "Turn on"}
          </Button>
        )}
      </div>
    </div>
  );
}
