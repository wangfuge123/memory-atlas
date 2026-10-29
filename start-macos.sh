#!/bin/bash
set -eu
ROOT="$(cd -- "$(dirname -- "$0")" && pwd)"
if [ "$(uname -s)" != Darwin ]; then
  echo 'This launcher requires macOS. On Windows, use start.bat.' >&2
  exit 1
fi
case "$(uname -m)" in
  arm64) ARCH=arm64 ;;
  x86_64) ARCH=x64 ;;
  *) echo 'Unsupported Mac architecture.' >&2; exit 1 ;;
esac
PYTHON="$ROOT/runtime/macos-$ARCH/python/bin/python3"
if [ ! -x "$PYTHON" ]; then
  . "$ROOT/scripts/macos-runtimes.sh"
  mkdir -p "$ROOT/runtime"
  STAGING="$(mktemp -d "$ROOT/runtime/.macos-download.XXXXXX")"
  trap 'rm -f "$STAGING/python.tar.gz" "$STAGING/expected.sha256"' EXIT
  echo '首次启动：正在准备便携 Python。下载后将核验 SHA-256，请稍候。'
  /usr/bin/curl --fail --location --retry 2 --connect-timeout 15 --max-time 240 \
    "$RUNTIME_URL" --output "$STAGING/python.tar.gz"
  printf '%s  %s\n' "$RUNTIME_SHA256" "$STAGING/python.tar.gz" > "$STAGING/expected.sha256"
  /usr/bin/shasum -a 256 -c "$STAGING/expected.sha256"
  mkdir "$STAGING/extracted"
  /usr/bin/tar -xzf "$STAGING/python.tar.gz" -C "$STAGING/extracted"
  if [ -e "$ROOT/runtime/macos-$ARCH" ]; then
    echo 'An incomplete runtime already exists. Rename that runtime folder and retry.' >&2
    exit 1
  fi
  mv "$STAGING/extracted" "$ROOT/runtime/macos-$ARCH"
fi
export PYTHONUTF8=1
exec "$PYTHON" "$ROOT/start_local.py" "$@"
