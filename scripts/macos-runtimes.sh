# Pinned CPython builds from astral-sh/python-build-standalone.
case "$ARCH" in
  arm64)
    RUNTIME_URL='https://github.com/astral-sh/python-build-standalone/releases/download/20261026/cpython-3.13.18%2B20261026-aarch64-apple-darwin-install_only.tar.gz'
    RUNTIME_SHA256='e5af2fde6a937a0e0c795a0c595c4efb70578d57463a2657c819992b9b9acbac'
    ;;
  x64)
    RUNTIME_URL='https://github.com/astral-sh/python-build-standalone/releases/download/20261026/cpython-3.13.18%2B20261026-x86_64-apple-darwin-install_only.tar.gz'
    RUNTIME_SHA256='708be9e7df297f68bdae589ea9e62a621db5abe7708f79e851c41410347452d1'
    ;;
  *) echo "Unsupported Mac architecture: $ARCH" >&2; exit 1 ;;
esac
