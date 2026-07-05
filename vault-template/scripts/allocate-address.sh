#!/usr/bin/env bash
# allocate-address.sh — hand out the next wiki address (c-000001, c-000002, ...).
#
# A monotonic counter under .vault-meta/. Single-user local vault, so a short
# mkdir spinlock is all the mutual exclusion needed (mkdir is atomic on POSIX,
# and works on macOS where flock isn't installed).
#
#   ./scripts/allocate-address.sh            # reserve + print the next address
#   ./scripts/allocate-address.sh --peek     # print the next value without reserving
#   ./scripts/allocate-address.sh --selftest # assert two allocations are monotonic
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COUNTER="$ROOT/.vault-meta/address-counter.txt"
LOCK="$ROOT/.vault-meta/.address.lock.d"

next() { printf 'c-%06d\n' "$1"; }

peek() {
  mkdir -p "$(dirname "$COUNTER")"
  local cur; cur="$(cat "$COUNTER" 2>/dev/null || echo 0)"
  [[ "$cur" =~ ^[0-9]+$ ]] || { echo "ERR: counter corrupt: $cur" >&2; exit 3; }
  next $((cur + 1))
}

allocate() {
  mkdir -p "$(dirname "$COUNTER")"
  local tries=0
  until mkdir "$LOCK" 2>/dev/null; do
    tries=$((tries + 1)); [ "$tries" -ge 100 ] && { echo "ERR: lock timeout" >&2; exit 1; }
    sleep 0.05
  done
  trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT
  local cur; cur="$(cat "$COUNTER" 2>/dev/null || echo 0)"
  [[ "$cur" =~ ^[0-9]+$ ]] || { echo "ERR: counter corrupt: $cur" >&2; exit 3; }
  local n=$((cur + 1))
  echo "$n" > "$COUNTER"
  next "$n"
}

case "${1:-allocate}" in
  --peek) peek ;;
  --selftest)
    tmp="$(mktemp -d)"; ROOT="$tmp"; COUNTER="$tmp/.vault-meta/address-counter.txt"; LOCK="$tmp/.vault-meta/.address.lock.d"
    a="$(allocate)"; trap - EXIT; rmdir "$LOCK" 2>/dev/null || true
    b="$(allocate)"; trap - EXIT; rmdir "$LOCK" 2>/dev/null || true
    [ "$a" = "c-000001" ] && [ "$b" = "c-000002" ] || { echo "FAIL: $a then $b" >&2; exit 1; }
    echo "ok: $a then $b"; rm -rf "$tmp" ;;
  allocate) allocate ;;
  *) echo "usage: allocate-address.sh [--peek|--selftest]" >&2; exit 2 ;;
esac
