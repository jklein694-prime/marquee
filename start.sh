#!/bin/sh
# Rebuild and (re)start the marquee pm2 process.
set -e
cd "$(dirname "$0")"
npm run build
pm2 restart marquee 2>/dev/null || pm2 start "npm run start" --name marquee
pm2 status marquee
