// Web Push: when a chat turn finishes while the app is in the background
// (the client said so via /api/turns/<id>/detach), notify every subscribed
// device. VAPID keys are generated on first use and kept in data/vapid.json;
// subscriptions live in data/push.json. iOS delivers these only to the
// home-screen app, over HTTPS (see host-mode.sh).
import fs from "fs";
import path from "path";
import webpush, { type PushSubscription } from "web-push";
import { onTurnFinished, type Turn } from "./turns";

const KEYS = path.join(process.cwd(), "data/vapid.json");
const SUBS = path.join(process.cwd(), "data/push.json");

interface Vapid {
  publicKey: string;
  privateKey: string;
}

function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export function vapidKeys(): Vapid {
  try {
    const k = JSON.parse(fs.readFileSync(KEYS, "utf8")) as Vapid;
    if (k.publicKey && k.privateKey) return k;
  } catch {}
  const k = webpush.generateVAPIDKeys();
  writeJson(KEYS, k);
  return k;
}

export function subscriptions(): PushSubscription[] {
  try {
    const v = JSON.parse(fs.readFileSync(SUBS, "utf8"));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function addSubscription(sub: PushSubscription) {
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error("invalid subscription");
  writeJson(SUBS, [...subscriptions().filter((s) => s.endpoint !== sub.endpoint), sub]);
}

export function removeSubscription(endpoint: string) {
  writeJson(SUBS, subscriptions().filter((s) => s.endpoint !== endpoint));
}

/** what the notification says: the start of the reply, else a generic line */
export function summarize(turn: Pick<Turn, "events">): string {
  const text = turn.events
    .filter((e) => e.type === "text")
    .map((e) => String(e.delta ?? ""))
    .join("")
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const widget = turn.events.find((e) => e.type === "widget");
  if (text) return text.length > 140 ? text.slice(0, 137) + "…" : text;
  if (widget?.widget === "recs") return "Your picks are ready.";
  if (widget) return "Louie has a question for you.";
  return "Your reply is ready.";
}

export async function notifyAll(payload: { title: string; body: string; url?: string; tag?: string }) {
  const subs = subscriptions();
  if (!subs.length) return 0;
  const keys = vapidKeys();
  const subject = process.env.PUSH_SUBJECT || "mailto:marquee@example.com";
  let sent = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload), {
          vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
          TTL: 60 * 60,
        });
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        // the device unsubscribed or the app was deleted: forget it
        if (code === 404 || code === 410) removeSubscription(sub.endpoint);
      }
    })
  );
  return sent;
}

// one registration per process, survives dev-mode module reloads
const g = globalThis as unknown as { __marqueePushHook?: boolean };
if (!g.__marqueePushHook) {
  g.__marqueePushHook = true;
  onTurnFinished((turn) => {
    if (!turn.detached || turn.silent) return;
    void notifyAll({ title: "Marquee", body: summarize(turn), url: "/", tag: "marquee-reply" }).catch(() => {});
  });
}
