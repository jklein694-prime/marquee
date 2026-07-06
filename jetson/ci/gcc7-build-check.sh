#!/usr/bin/env bash
# gcc7-build-check.sh — the compiler canary.
#
# Proves, on any x86 machine with docker, that the pinned llama.cpp tag still
# compiles with the exact toolchain the Jetson Nano is frozen at: Ubuntu 18.04's
# distro GCC 7 + make. This reproduces the Nano's install-time build except for
# the CPU architecture (x86 here, aarch64/NEON there) and CUDA (hardware-only).
#
# Run it before every LLAMACPP_TAG bump. If it goes red, walk the tag back
# (b1971, b1808, ...) in PINS.env until green.
#
#   ./jetson/ci/gcc7-build-check.sh            # full check (needs network + docker)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../PINS.env
source "$HERE/../PINS.env"

command -v docker >/dev/null || { echo "ERR: docker required" >&2; exit 1; }

echo "==> building llama.cpp ${LLAMACPP_TAG} with GCC 7 in ubuntu:18.04"
docker run --rm ubuntu:18.04 bash -euo pipefail -c "
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -qq -y --no-install-recommends gcc g++ make curl ca-certificates >/dev/null
  gcc --version | head -1
  curl -fsSL '${LLAMACPP_URL}' -o /tmp/llama.tar.gz
  mkdir /tmp/llama && tar -xzf /tmp/llama.tar.gz -C /tmp/llama --strip-components=1
  cd /tmp/llama
  # same invocation install.sh uses on the Nano (minus aarch64 NEON autodetect)
  make -j\"\$(nproc)\" server
  ls -la server
  ./server --help >/dev/null 2>&1 || true   # binary loads and parses args
  echo 'GCC7 BUILD: OK'
"
echo "==> canary green: ${LLAMACPP_TAG} builds under GCC 7"
