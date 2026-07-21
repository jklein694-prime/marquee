# QUICKSTART — flash a 256GB microSD and reach the Nano over SSH (macOS)

A single, ordered walkthrough for the common setup: **a Mac, one 256GB microSD
that holds everything (OS + models + vault), a USB/M.2 WiFi dongle, and no
keyboard/monitor on the Nano.** Follow it top to bottom.

> **The one thing people get wrong:** don't copy the payload onto the microSD
> from your Mac. Once you flash JetPack, that card becomes the Nano's **Linux
> (ext4)** disk — macOS can't write to it, and flashing erases anything you put
> there. The payload reaches the Nano **over the USB cable / WiFi** in step 5.
> One card does everything; you don't need a second drive.

## 0. What you need
- Your Mac + a microSD card reader.
- The 256GB microSD.
- The Jetson Nano + its 5V power supply.
- Your WiFi dongle (or M.2 card).
- A **data** micro-USB cable (many charge-only cables won't enumerate the serial
  device — use one you know carries data).
- [Balena Etcher](https://balena.io/etcher).

## 1. Reset (erase) the microSD
Open **Disk Utility** → menu **View ▸ Show All Devices** → select the ~256GB
**device** (the top-level entry, not a sub-volume) → **Erase** → Format
**ExFAT**, Scheme **GUID Partition Map** → Erase.

*If the volume "disappeared" after a copy:* it's just unmounted. In Terminal,
`diskutil list` to find it (e.g. `/dev/disk4`), then `diskutil mountDisk
/dev/disk4`. If it says "not readable," ignore it and Erase as above — you're
about to overwrite it anyway. The card is almost certainly fine.

## 2. Build the payload on your Mac (you've done this)
```bash
cd marquee/jetson
bash build-payload.sh --vault /path/to/your/obsidian/vault
```
Produces `wikigardener-payload/` (~1.5 GB: the model + llama.cpp source + code).
**Leave it on your Mac** — it goes to the Nano in step 5, not onto the card.

## 3. Flash JetPack to the microSD

**Get the right image.** The original Nano tops out at **JetPack 4.6.x** — do
**not** download JetPack 5 or 6 (those are Orin-only and won't boot). Free
NVIDIA login required; the download is a ~6 GB `.zip` — **don't unzip it**.

- **4GB devkit** (round barrel-jack power port, 4× USB-A, HDMI **and**
  DisplayPort; board rev A02/B01 both fine):
  [Get Started — Jetson Nano Developer Kit](https://developer.nvidia.com/embedded/learn/get-started-jetson-nano-devkit)
  → "Download the Jetson Nano Developer Kit SD Card Image".
- **2GB devkit** (USB-C power only, fewer USB ports, HDMI only, "2GB" printed
  on the board):
  [Get Started — Jetson Nano 2GB](https://developer.nvidia.com/embedded/learn/get-started-jetson-nano-2gb-devkit).
- Backups if those redirect: [JetPack 4.6 page](https://developer.nvidia.com/embedded/jetpack-sdk-46)
  · [Jetson Download Center](https://developer.nvidia.com/embedded/downloads).

**Flash it — either way works** (~15–25 min; it writes ~14 GB and the Nano
grows it to fill the 256 GB on first boot):

- **Etcher**: **Flash from file** → the `.zip` → **Select target** → the
  microSD (⚠️ **check the size so you don't wipe your Mac's disk**) → **Flash**.
- **Or the bundled one-command flasher** (macOS, guardrailed — refuses internal
  disks and makes you type the disk id back):
  ```bash
  diskutil list external            # find the card, e.g. /dev/disk4
  bash jetson/laptop/flash-sd.sh ~/Downloads/jetson-nano-sd-card-image.zip disk4
  ```

When macOS afterwards says **"The disk you inserted was not readable"** —
that's *expected* (the card is now Linux-formatted). Click **Eject**, never
Initialize.

## 4. First boot, no keyboard — over the USB serial console
1. Insert the microSD and the WiFi dongle into the Nano.
2. Connect the **data** micro-USB cable from the Nano to your Mac.
3. Power on the Nano.
4. On the Mac, find and open the serial console:
   ```bash
   ls /dev/tty.usbmodem*
   screen /dev/tty.usbmodemXXXX 115200     # use the name you just saw
   ```
5. NVIDIA's first-boot setup appears in that terminal. Complete it: create the
   user **`gardener`**, accept the EULA, pick locale/timezone. (No monitor
   needed — it's all in this window. To leave `screen` later: **Ctrl-A** then **K**,
   confirm `y`.)

## 5. Get the payload onto the Nano
The USB cable also gives the Nano a network address at **192.168.55.1** — no WiFi
required yet. Still in the serial session you can optionally join WiFi now:
```bash
nmcli device wifi connect "YOUR_SSID" password "YOUR_WIFI_PASSWORD"
hostname -I          # shows the WiFi IP too, if you connected
```
Then, from a **normal Mac terminal** (not the screen session), copy the payload:
```bash
scp -r wikigardener-payload gardener@192.168.55.1:~/     # over the USB cable
# or, if on WiFi:  scp -r wikigardener-payload gardener@<wifi-ip>:~/
```

## 6. Install (on the Nano)
Back in the serial session (or `ssh gardener@192.168.55.1`):
```bash
sudo bash ~/wikigardener-payload/install.sh
```
This builds llama.cpp on the Nano — **~20–40 minutes, one time** — then installs
the model, services, and seeds the vault. If it lists missing packages, run the
single `apt install` line it prints (needs WiFi once), then re-run install.sh.

## 7. Finish setup
```bash
sudo wikigardener setup
```
Walks you through: **WiFi** (saved — the Nano auto-rejoins on every boot),
**hostname** (`wikigardener`), **SSH** (enables it + sets your password), and an
optional model/prompt tune. At the end it prints your SSH address and the
dashboard URL.

## 8. Done — unplug the cable
From now on, just power the Nano on. It joins WiFi and is ready:
```bash
ssh gardener@wikigardener.local          # from your Mac, no cable
```
- Dashboard: `http://<nano-ip>:8088` (password = `/etc/wikigardener/dashboard.token`).
- Everything — models, vault, git history, swap — lives on the 256GB card.
- Watch it work: `journalctl -fu gardener`.

## Troubleshooting
- **microSD volume vanished on the Mac** → step 1 recovery (`diskutil
  mountDisk`, or Erase; you're overwriting it anyway).
- **WiFi dongle won't connect** → on the Nano, `dmesg | grep -i wlan`. The
  original Nano has no built-in WiFi; the dongle's chipset must be in JetPack's
  kernel (Realtek RTL8188/8192/8821, Intel 8265/9260…). Unsupported = swap the
  dongle, or use Ethernet for setup.
- **`wikigardener.local` doesn't resolve** → use the IP (`hostname -I` on the
  Nano) or `192.168.55.1` over the USB cable.
- **No `/dev/tty.usbmodem*`** → charge-only cable or wrong port; try a known
  data cable / another USB port; give the Nano ~30 s after power-on.
- **Etcher "flash failed / verification failed"** → re-seat the reader, re-erase
  the card, try again; a failing card reader is the usual culprit.
