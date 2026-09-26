#!/bin/sh
# Campfire installer.
#
# POSIX sh only (no bashisms). Installs the campfire CLI from a versioned
# GitHub release tarball, falling back to an npm git install when the
# tarball for this platform is missing.
#
# Canonical usage:
#   curl -fsSL https://boringinfra.company/campfire/install.sh | sh
#
# Pinned version:
#   curl -fsSL https://boringinfra.company/campfire/install.sh | sh -s -- --version 1.0.0
#
# Environment:
#   CAMPREFIX             install prefix (default: /usr/local when writable,
#                         otherwise ~/.local). BINDIR=$CAMPREFIX/bin.
#   CAMPFIRE_VERSION      version to install, with or without leading "v"
#                         (default: latest).
#   CAMPFIRE_URL          Campfire server URL. Not used for downloading; it is
#                         remembered in the installer's closing line (the CLI
#                         reads CAMPFIRE_URL at runtime).
#   CAMPFIRE_RELEASE_BASE release host (default:
#                         https://github.com/BoringInfraCo/Campfire).
#   CAMPFIRE_TARBALL      override: local file path or http(s) URL of a
#                         campfire tarball. Skips release resolution (used for
#                         testing and mirrors).
#   CAMPFIRE_DRY_RUN=1    print the install plan without changing anything.
#
# Product invariant: installing never requires silent privilege escalation
# and never installs a Node.js toolchain for you.
set -eu

PROG="install.sh"
DEFAULT_RELEASE_BASE="https://github.com/BoringInfraCo/Campfire"
REPO_SPEC="BoringInfraCo/Campfire"

VERSION="${CAMPFIRE_VERSION:-latest}"
PREFIX="${CAMPREFIX:-}"
SERVER_URL="${CAMPFIRE_URL:-}"
RELEASE_BASE="${CAMPFIRE_RELEASE_BASE:-$DEFAULT_RELEASE_BASE}"
TARBALL_OVERRIDE="${CAMPFIRE_TARBALL:-}"
DRY_RUN="${CAMPFIRE_DRY_RUN:-0}"
ASSUME_YES=0

usage() {
  cat <<'EOF'
Campfire installer — installs the campfire CLI for your team workspace.

Usage:
  curl -fsSL https://boringinfra.company/campfire/install.sh | sh [-s -- FLAGS]

Flags:
  --prefix DIR     install prefix (default: /usr/local if writable,
                   otherwise ~/.local). Binary lands in DIR/bin.
  --version VER    version to install, e.g. 1.0.0 (default: latest).
  --url URL        Campfire server URL. Remembered in the installer's closing
                   line; the CLI reads CAMPFIRE_URL at runtime.
  --dry-run        print the install plan without changing anything.
  --yes            assume "yes" for the explicit sudo prompt.
  -h, --help       print this help and exit.

Environment equivalents: CAMPREFIX, CAMPFIRE_VERSION, CAMPFIRE_URL,
CAMPFIRE_RELEASE_BASE, CAMPFIRE_TARBALL, CAMPFIRE_DRY_RUN=1.

Examples:
  curl -fsSL https://boringinfra.company/campfire/install.sh | sh
  curl -fsSL https://boringinfra.company/campfire/install.sh | sh -s -- --version 1.0.0
  CAMPREFIX=~/.local sh install.sh --dry-run
EOF
}

log() {
  printf '%s\n' "$1"
}

fail() {
  printf '%s: error: %s\n' "$PROG" "$1" >&2
  exit 1
}

print_next_steps() {
  log ""
  if [ -n "$SERVER_URL" ]; then
    log "This install will talk to $SERVER_URL."
  fi
  log "Run  campfire  to create your first workspace."
}

# ---- argument parsing (POSIX: no getopt) ----
while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --prefix)
      [ "$#" -ge 2 ] || fail "--prefix requires a directory argument"
      PREFIX="$2"
      shift 2
      ;;
    --prefix=*)
      PREFIX="${1#--prefix=}"
      shift
      ;;
    --version)
      [ "$#" -ge 2 ] || fail "--version requires a version argument"
      VERSION="$2"
      shift 2
      ;;
    --version=*)
      VERSION="${1#--version=}"
      shift
      ;;
    --url)
      [ "$#" -ge 2 ] || fail "--url requires a URL argument"
      SERVER_URL="$2"
      shift 2
      ;;
    --url=*)
      SERVER_URL="${1#--url=}"
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --yes|-y)
      ASSUME_YES=1
      shift
      ;;
    --)
      shift
      break
      ;;
    -*)
      fail "unknown flag: $1 (see --help)"
      ;;
    *)
      fail "unexpected argument: $1 (see --help)"
      ;;
  esac
done

[ "$#" -eq 0 ] || fail "unexpected argument: $1 (see --help)"
[ -n "$VERSION" ] || fail "version must not be empty (see --help)"

# ---- prerequisites: curl, tar, node>=22 (friendly error, no auto-install) ----
command -v curl >/dev/null 2>&1 || fail "curl is required but was not found on PATH"
command -v tar >/dev/null 2>&1 || fail "tar is required but was not found on PATH"

if ! command -v node >/dev/null 2>&1; then
  fail "node >= 22 is required but was not found on PATH. Install Node.js 22+ from https://nodejs.org (or your system package manager) and re-run this installer. This installer never installs Node.js for you."
fi
node_ver="$(node --version 2>/dev/null)" || fail "could not run 'node --version'"
node_ver="${node_ver#v}"
node_major="${node_ver%%.*}"
case "$node_major" in
  ''|*[!0-9]*)
    fail "could not parse node version from '$node_ver'; expected e.g. v22.x.y"
    ;;
esac
if [ "$node_major" -lt 22 ]; then
  fail "node >= 22 is required but found '$node_ver'. Install Node.js 22+ from https://nodejs.org and re-run. This installer never upgrades Node.js for you."
fi

# ---- platform allowlist ----
os_raw="$(uname -s)"
case "$os_raw" in
  Darwin) OS="darwin" ;;
  Linux) OS="linux" ;;
  *) fail "unsupported OS '$os_raw'. Campfire release tarballs exist for: darwin, linux." ;;
esac

arch_raw="$(uname -m)"
case "$arch_raw" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64|amd64) ARCH="x64" ;;
  *) fail "unsupported architecture '$arch_raw'. Campfire release tarballs exist for: arm64, x64." ;;
esac

# ---- prefix default: /usr/local when writable, else ~/.local ----
if [ -z "$PREFIX" ]; then
  if [ -d "/usr/local" ] && [ -w "/usr/local" ]; then
    PREFIX="/usr/local"
  else
    [ -n "${HOME:-}" ] || fail "HOME is unset and CAMPREFIX was not provided"
    PREFIX="$HOME/.local"
  fi
fi
case "$PREFIX" in
  /*) ;;
  *) fail "CAMPREFIX must be an absolute path, got '$PREFIX'" ;;
esac
BINDIR="$PREFIX/bin"
LIBDIR="$PREFIX/lib/campfire"

# ---- resolve tarball source ----
TARBALL_URL=""
SUM_URL=""
LOCAL_TARBALL=""
LOCAL_SUM=""
USING_RELEASE=0

if [ -n "$TARBALL_OVERRIDE" ]; then
  case "$TARBALL_OVERRIDE" in
    http://*|https://*)
      TARBALL_URL="$TARBALL_OVERRIDE"
      ;;
    *)
      [ -f "$TARBALL_OVERRIDE" ] || fail "CAMPFIRE_TARBALL file not found: $TARBALL_OVERRIDE"
      LOCAL_TARBALL="$TARBALL_OVERRIDE"
      if [ -f "$TARBALL_OVERRIDE.sha256" ]; then
        LOCAL_SUM="$TARBALL_OVERRIDE.sha256"
      fi
      ;;
  esac
else
  case "$VERSION" in
    latest)
      TARBALL_URL="$RELEASE_BASE/releases/latest/download/campfire-$OS-$ARCH.tar.gz"
      ;;
    *)
      norm="$VERSION"
      case "$norm" in
        v*|V*) norm="$(printf '%s' "$norm" | cut -c 2-)" ;;
      esac
      [ -n "$norm" ] || fail "version must not be empty (see --help)"
      VERSION="$norm"
      TARBALL_URL="$RELEASE_BASE/releases/download/v$VERSION/campfire-$OS-$ARCH.tar.gz"
      ;;
  esac
  SUM_URL="$TARBALL_URL.sha256"
  USING_RELEASE=1
fi

# ---- dry run: report plan, change nothing ----
if [ "$DRY_RUN" = "1" ]; then
  log "Campfire install plan (dry run, nothing changed):"
  log "  os/arch:      $OS/$ARCH"
  log "  version:      $VERSION (node $node_ver)"
  if [ -n "$LOCAL_TARBALL" ]; then
    log "  tarball:      $LOCAL_TARBALL (local file)"
  else
    log "  tarball:      $TARBALL_URL"
  fi
  log "  binary:       $BINDIR/campfire"
  log "  library:      $LIBDIR"
  if [ -n "$SERVER_URL" ]; then
    log "  server:       $SERVER_URL"
  fi
  exit 0
fi

TMP_DIR=""
cleanup() {
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT INT TERM
TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t campfire-install)"
PKG="$TMP_DIR/campfire.tar.gz"

# ---- fetch tarball (or fall back to npm git install) ----
npm_fallback() {
  # $1 = human-readable reason the tarball path failed
  if ! command -v npm >/dev/null 2>&1; then
    fail "$1, and no npm fallback is possible because npm was not found on PATH alongside node."
  fi
  spec="github:$REPO_SPEC"
  if [ "$VERSION" != "latest" ]; then
    spec="github:$REPO_SPEC#v$VERSION"
  fi
  log "Tarball unavailable ($1)."
  log "Falling back to: npm install -g $spec"
  npm install -g "$spec" || fail "npm fallback failed. Install from source instead: git clone https://github.com/$REPO_SPEC && cd Campfire && npm ci && npm run build."
  command -v campfire >/dev/null 2>&1 || fail "npm install succeeded but 'campfire' is not on PATH"
  campfire --help >/dev/null 2>&1 || fail "npm-installed campfire failed to run 'campfire --help'"
  log "Installed campfire via npm."
  print_next_steps "$(command -v campfire)"
  exit 0
}

if [ -n "$LOCAL_TARBALL" ]; then
  cp "$LOCAL_TARBALL" "$PKG" || fail "could not copy $LOCAL_TARBALL"
elif ! curl -fsSL -o "$PKG" "$TARBALL_URL"; then
  if [ "$USING_RELEASE" = "1" ]; then
    npm_fallback "no release tarball for $OS/$ARCH at $TARBALL_URL"
  else
    fail "could not download $TARBALL_URL"
  fi
fi

# ---- sha256 verification when a checksum is available ----
SUM_FILE=""
if [ -n "$LOCAL_SUM" ]; then
  SUM_FILE="$LOCAL_SUM"
elif [ -n "$SUM_URL" ]; then
  if curl -fsSL -o "$TMP_DIR/campfire.tar.gz.sha256" "$SUM_URL" 2>/dev/null; then
    SUM_FILE="$TMP_DIR/campfire.tar.gz.sha256"
  else
    log "Note: no .sha256 published for this tarball; skipping checksum verification."
  fi
fi

if [ -n "$SUM_FILE" ]; then
  expected="$(cut -d ' ' -f 1 < "$SUM_FILE")"
  case "$expected" in
    ''|*[!0-9a-fA-F]*)
      fail "checksum file $SUM_FILE did not start with a hex digest"
      ;;
  esac
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum < "$PKG" | cut -d ' ' -f 1)"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 < "$PKG" | cut -d ' ' -f 1)"
  else
    fail "a checksum was published but neither sha256sum nor shasum is available to verify it"
  fi
  [ "$expected" = "$actual" ] || fail "sha256 mismatch for campfire tarball (expected $expected, got $actual)"
  log "Checksum verified (sha256 $actual)."
fi

# ---- privileged install: no sudo unless needed, and only after prompting ----
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  need_sudo=0
  if ! mkdir -p "$BINDIR" "$LIBDIR" 2>/dev/null; then
    need_sudo=1
  fi
  if [ ! -w "$BINDIR" ] || [ ! -w "$LIBDIR" ]; then
    need_sudo=1
  fi
  if [ "$need_sudo" = "1" ]; then
    command -v sudo >/dev/null 2>&1 || fail "$BINDIR is not writable and sudo is unavailable. Re-run with a writable prefix, e.g. CAMPREFIX=\$HOME/.local sh $PROG."
    if [ "$ASSUME_YES" != "1" ]; then
      printf '%s needs sudo to write to %s. Allow? [y/N] ' "$PROG" "$PREFIX" > /dev/tty || fail "no terminal available to confirm sudo. Re-run with --yes or use CAMPREFIX=\$HOME/.local."
      answer=""
      read -r answer < /dev/tty || fail "could not read confirmation. Re-run with --yes or use CAMPREFIX=\$HOME/.local."
      case "$answer" in
        y|Y|yes|YES) ;;
        *) fail "declined sudo. Re-run with a writable prefix, e.g. CAMPREFIX=\$HOME/.local sh $PROG." ;;
      esac
    fi
    SUDO="sudo"
  fi
fi

# ---- unpack and install ----
if [ -n "$SUDO" ]; then
  $SUDO mkdir -p "$BINDIR" "$LIBDIR" || fail "could not create $BINDIR / $LIBDIR"
else
  mkdir -p "$BINDIR" "$LIBDIR" || fail "could not create $BINDIR / $LIBDIR"
fi

tar -xzf "$PKG" -C "$TMP_DIR" || fail "could not unpack campfire tarball"
[ -f "$TMP_DIR/bin/campfire" ] || fail "tarball missing bin/campfire; refusing to install"
[ -d "$TMP_DIR/lib/campfire" ] || fail "tarball missing lib/campfire; refusing to install"

# The request label "latest" is not the installed version, and a pinned
# request must not replace an existing install when the archive disagrees.
pkg_json="$TMP_DIR/lib/campfire/package.json"
[ -f "$pkg_json" ] || fail "tarball missing lib/campfire/package.json; refusing to replace an existing install"
package_version="$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$pkg_json" | head -n 1)"
[ -n "$package_version" ] || fail "tarball lib/campfire/package.json has no version field; refusing to replace an existing install"
if [ "$VERSION" != "latest" ] && [ "$package_version" != "$VERSION" ]; then
  fail "archive package version $package_version does not match requested version $VERSION"
fi

if [ -n "$SUDO" ]; then
  $SUDO cp "$TMP_DIR/bin/campfire" "$BINDIR/campfire" || fail "could not install binary to $BINDIR"
  $SUDO chmod +x "$BINDIR/campfire" || fail "could not chmod $BINDIR/campfire"
  $SUDO rm -rf "$LIBDIR" || fail "could not clear previous install at $LIBDIR"
  $SUDO cp -R "$TMP_DIR/lib/campfire" "$LIBDIR" || fail "could not install library to $LIBDIR"
else
  cp "$TMP_DIR/bin/campfire" "$BINDIR/campfire" || fail "could not install binary to $BINDIR"
  chmod +x "$BINDIR/campfire" || fail "could not chmod $BINDIR/campfire"
  rm -rf "$LIBDIR" || fail "could not clear previous install at $LIBDIR"
  cp -R "$TMP_DIR/lib/campfire" "$LIBDIR" || fail "could not install library to $LIBDIR"
fi

# The CLI silently exits 0 when argv[1] is not a normalized path, so require
# real output here — exit code alone proves nothing.
help_out="$("$BINDIR/campfire" --help 2>&1)" || fail "installed binary failed '$BINDIR/campfire --help'"
[ -n "$help_out" ] || fail "installed binary printed nothing for '$BINDIR/campfire --help'"
log "Installed campfire $package_version to $BINDIR/campfire ($OS/$ARCH)."

case ":$PATH:" in
  *":$BINDIR:"*) ;;
  *)
    log "Note: $BINDIR is not on your PATH. Add it, e.g.:"
    log "  export PATH=\"$BINDIR:\$PATH\""
    ;;
esac

print_next_steps "$BINDIR/campfire"
