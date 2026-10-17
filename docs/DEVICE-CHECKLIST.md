# Device checklist

The automated gates run on Chromium with phone viewports. Real Safari on an
installed home-screen app is the one thing they cannot cover, so run this on
the phone before each release. Five minutes, in order.

Setup: Marquee installed from the Nano's HTTPS Tailscale address (Share ->
Add to Home Screen), opened from the home screen, notifications on.

## Shell

- [ ] Status bar is solid dark; nothing sits under the notch or the home indicator.
- [ ] Bottom bar has five icons with labels; the active one is amber with a bar above it.
- [ ] Tap the chat box: the keyboard rises, the bottom bar hides, the box and Send stay visible.
- [ ] Dismiss the keyboard: the bottom bar returns.
- [ ] Pull down on the chat and on a panel: no page bounce, no browser reload.
- [ ] Rotate to landscape: no clipped edges, the chat input still reachable.

## Chat

- [ ] Send "I watched Heat, loved it": the reply streams without typing lag; the busy strip shows activity and Stop.
- [ ] A choice widget's options are easy to hit with a thumb; a tapped option sends at once.
- [ ] Lock the phone mid-reply, wait 30 s, unlock: the rest of the reply is there.
- [ ] With Marquee backgrounded, a finished reply sends a notification; tapping it opens the app.

## Watchlist

- [ ] Open a card's ⋮ menu, then tap somewhere else on the page: the menu closes (iOS does not fire mouse events on plain elements, so this is the thing to check).
- [ ] Watched it: the rating grid is two rows of five, each cell a comfortable tap.
- [ ] Up/down arrows reorder; the # badge updates.
- [ ] Service chips toggle and survive a reload.

## Quick Rate and Screen Test

- [ ] Search results appear while typing; picking one shows the poster row with the rating grid below it, full width.
- [ ] Log it: the "logging…" line appears, then "Logged …".
- [ ] Screen Test: the 3D show runs, the verdict card fits the screen, "+ My watchlist" works.

## Taste Graph

- [ ] Opens framed to the whole constellation; no labels until you pinch in, then category names first.
- [ ] Tap a node: a bottom sheet opens with the page; drag down or tap outside closes it.
- [ ] Leave the graph tab open for a minute with nothing happening: the phone does not get warm (2D idle).
- [ ] Switch to 3D, then to another tab: the phone cools (render loop paused).
- [ ] The i button shows the legend; colors match the Help text.

## Help and More

- [ ] Section chips scroll sideways in one row.
- [ ] Notifications card shows the right state (on/off/needs install).

Anything that fails here goes in an issue with the phone model and iOS version.
