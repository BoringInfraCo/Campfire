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
#   CAMPFIRE_TELEMETRY    set to 0, off, false, or no to disable the anonymous
#                         install_completed report. Unset or empty means enabled.
#   CAMPFIRE_TELEMETRY_URL override for the telemetry ingestion endpoint
#                         (default: the production endpoint below).
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

# ---- anonymous install_completed report (TEL-001D) ----
#
# WHY THIS IS SHAPED LIKE THIS: by the time report_install_completed runs,
# Campfire is already installed and working. The installer's exit code must be
# identical whether this POST succeeds, fails, times out, redirects, or the
# endpoint does not exist at all (TEL-001 section 13). Therefore nothing in this
# section may call fail, may set a non-zero status, may write outside the local
# config directory, and may run before the install steps have completed. Every
# step is either wrapped in `( ... ) >/dev/null 2>&1 || true` or explicitly
# ignored. Telemetry is measurement, never part of the install transaction.

DEFAULT_TELEMETRY_ENDPOINT="https://boringinfra.company/campfire/v1/telemetry"

# POSIX sh has no ${var//...}; a single sed strips surrounding whitespace. Used
# a handful of times per run, so the extra process is not worth a loop.
trim_value() {
  printf '%s' "$1" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

# The config directory, resolved exactly as src/bootstrap/profile.ts
# resolveProfilePaths does: CAMPFIRE_CONFIG_DIR, then XDG_CONFIG_HOME/campfire,
# then $HOME/.config/campfire. $HOME is used here and only here, to locate a
# directory -- it is never part of the payload.
telemetry_config_dir() {
  configured="$(trim_value "${CAMPFIRE_CONFIG_DIR:-}")"
  if [ -n "$configured" ]; then
    printf '%s' "$configured"
    return 0
  fi
  xdg="$(trim_value "${XDG_CONFIG_HOME:-}")"
  if [ -n "$xdg" ]; then
    printf '%s/campfire' "$xdg"
    return 0
  fi
  home="$(trim_value "${HOME:-}")"
  [ -n "$home" ] || return 0
  printf '%s/.config/campfire' "$home"
}

# Lowercase hex UUID in the exact shape src/telemetry/contract.ts requires.
# The server rejects any other shape, so a malformed id is dropped rather than
# posted, and no escaping problem can turn into a broken JSON body.
is_installation_id() {
  case "$1" in
    ????????-????-????-????-????????????) ;;
    *) return 1 ;;
  esac
  case "$1" in
    *[!0-9a-f-]*) return 1 ;;
  esac
  return 0
}

# A random local installation id. uuidgen when present, otherwise 16 bytes from
# /dev/urandom shaped as UUIDv4. Nothing about the machine, the user, the
# network, or the repository is read: 122 bits of OS randomness and no inputs.
new_installation_id() {
  if command -v uuidgen >/dev/null 2>&1; then
    candidate="$(uuidgen 2>/dev/null | tr 'A-Z' 'a-z' | tr -d ' \n' || true)"
    if is_installation_id "$candidate"; then
      printf '%s' "$candidate"
      return 0
    fi
  fi
  raw="$(od -An -tx1 -N16 /dev/urandom 2>/dev/null | tr -d ' \n' || true)"
  case "$raw" in
    ????????????????????????????????) ;;
    *) return 0 ;;
  esac
  # Force the version nibble to 4 and the variant nibble into 8..b, exactly as a
  # v4 generator does, so the shape matches what the contract accepts.
  variant="$(printf '%s' "$raw" | cut -c 17)"
  case "$variant" in
    0|1|2|3|4|5|6|7) variant="8" ;;
  esac
  printf '%s-%s-4%s-%s%s-%s' \
    "$(printf '%s' "$raw" | cut -c 1-8)" \
    "$(printf '%s' "$raw" | cut -c 9-12)" \
    "$(printf '%s' "$raw" | cut -c 13-15)" \
    "$variant" \
    "$(printf '%s' "$raw" | cut -c 18-20)" \
    "$(printf '%s' "$raw" | cut -c 21-32)"
}

# Pull an existing installationId out of a telemetry.json without a JSON parser.
# Conservative: on anything unexpected the result is empty, and an empty result
# means "do not overwrite that file".
read_installation_id() {
  [ -f "$1" ] || return 0
  grep -o '"installationId"[[:space:]]*:[[:space:]]*"[^"]*"' "$1" 2>/dev/null |
    sed -n 's/.*"\([0-9a-f]\{8\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{12\}\)".*/\1/p' |
    head -n 1
}

# True when a recorded telemetry.json explicitly disables telemetry. This is what
# makes `campfire telemetry disable` authoritative for a LATER reinstall: the
# operator's decision is stored state, so a fresh install that still has that
# file must honour it rather than re-enabling reporting because it happened to
# run. Conservative by design -- anything that is not an unambiguous
# "enabled": false leaves the report enabled, matching the documented default,
# because failing open on an unreadable preference would silently ignore an
# opt-out the operator believed was in force.
telemetry_preference_disabled() {
  [ -f "$1" ] || return 1
  grep -q '"enabled"[[:space:]]*:[[:space:]]*false' "$1" 2>/dev/null
}

# $1 = the version string from the installed package.json.
report_install_completed() {
  # Same opt-out values as src/telemetry/state.ts. Unset or empty means enabled,
  # matching the documented default. Read defensively because an operator shell
  # may export whitespace around the value.
  setting="$(trim_value "${CAMPFIRE_TELEMETRY:-}" | tr 'A-Z' 'a-z' || true)"
  case "$setting" in
    0|off|false|no) return 0 ;;
  esac

  # Endpoint override, else the documented production endpoint. The URL is not
  # validated here: canonicalEndpoint does that in TypeScript, and a broken
  # value can only cost the event, never the install. One guard rejects the
  # empty string, which is the only value that cannot be repaired by curl.
  endpoint="$(trim_value "${CAMPFIRE_TELEMETRY_URL:-}")"
  if [ -z "$endpoint" ]; then
    endpoint="$DEFAULT_TELEMETRY_ENDPOINT"
  fi
  [ -n "$endpoint" ] || return 0

  config_dir="$(telemetry_config_dir || true)"
  state_file=""
  [ -n "$config_dir" ] && state_file="$config_dir/telemetry.json"

  # A recorded opt-out outranks everything above, including the default. An
  # operator who ran `campfire telemetry disable` must not see a reinstall start
  # reporting again.
  if [ -n "$state_file" ] && telemetry_preference_disabled "$state_file"; then
    return 0
  fi

  # IDENTITY PRESERVATION, AND WHY IT IS DELIBERATELY CONSERVATIVE: the shell
  # has no JSON parser, so rewriting an existing telemetry.json would risk
  # clobbering fields the TypeScript side owns (enabled, activatedOn,
  # lastActiveOn, installCompletedReported). Correctness of state preservation
  # beats writing completeness, so this file is written ONLY when it does not
  # exist at all. When it exists, the id is parsed out of it and the file is left
  # byte-for-byte untouched. A missing id inside an existing file therefore
  # yields a one-off id for this event rather than a rewritten file; the CLI's
  # own ensureInstallationId will mint the persistent id on first use.
  installation_id=""
  if [ -n "$state_file" ] && [ -f "$state_file" ]; then
    installation_id="$(read_installation_id "$state_file" || true)"
  fi
  if ! is_installation_id "$installation_id"; then
    installation_id="$(new_installation_id || true)"
  fi
  if ! is_installation_id "$installation_id"; then
    return 0
  fi

  if [ -n "$state_file" ] && [ ! -e "$state_file" ]; then
    (
      mkdir -p "$config_dir" 2>/dev/null || exit 0
      # noclobber: if the TypeScript side created the file between the check
      # above and this write, leave its version alone instead of racing it.
      set -C
      printf '{\n  "version": 1,\n  "installationId": "%s",\n  "installCompletedReported": true\n}\n' \
        "$installation_id" > "$state_file" 2>/dev/null || exit 0
    ) >/dev/null 2>&1 || true
  fi

  # PAYLOAD ALLOW-LIST. These seven keys are the entire body, written
  # explicitly to match src/telemetry/contract.ts serializeTelemetryEvent. There
  # is no interpolation of the working directory, the login name, the machine
  # name, the install prefix, the tarball URL, the OS release string, the MAC
  # address, or the Git identity, and there is deliberately no loop over
  # environment variables: a field that is not written by name cannot leave the
  # machine. $OS and $ARCH are reused from the platform allowlist
  # above so the installer and the CLI report identical strings for one machine.
  # The version is used verbatim only when it is a plain release string;
  # anything else degrades to "unknown" rather than risking a broken or
  # surprising JSON body.
  version="$1"
  case "$version" in
    ''|*[!0-9A-Za-z._+-]*) version="unknown" ;;
  esac

  (
    body="$(printf '{"schemaVersion":1,"event":"install_completed","installationId":"%s","campfireVersion":"%s","os":"%s","arch":"%s","installMethod":"curl"}' \
      "$installation_id" "$version" "$OS" "$ARCH")" || exit 0
    # Short timeouts are the point: -fs fails silently on any HTTP error and
    # --max-time/--connect-timeout cap the damage at two seconds, so a dead or
    # slow endpoint cannot make the installer look hung. No -L: a redirect
    # target is not the documented ingestion endpoint.
    curl -fs -o /dev/null \
      --connect-timeout 1 --max-time 2 \
      -H 'Content-Type: application/json' \
      --data "$body" \
      "$endpoint"
  ) >/dev/null 2>&1 || true
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

# Last, after every install step and after the closing output, so a failure path
# or a dry run never reports and the human-visible output above is untouched.
# The version reported is the one read out of the archive, not the requested
# label ("latest" is not a version). The npm fallback path above exits 0 from
# inside npm_fallback and reports nothing: its install method is not the curl
# tarball install this event describes, and mislabelling it would corrupt the
# install_method dimension.
report_install_completed "$package_version"
