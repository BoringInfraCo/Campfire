#!/bin/sh
# Build the versioned campfire release tarball for the current host.
#
# POSIX sh. Produces, for GitHub Releases:
#   release/campfire-{os}-{arch}.tar.gz
#   release/campfire-{os}-{arch}.tar.gz.sha256
# plus a versioned copy of the installer for static hosting:
#   public/campfire/vX.Y.Z/install.sh
#
# Tarball layout (mirrors the install prefix):
#   bin/campfire                        POSIX sh wrapper (node + bundled lib)
#   lib/campfire/{dist,package.json,package-lock.json,LICENSE,node_modules,tui}
#
# node_modules includes installed production deps only, copied from the build
# host so the native better-sqlite3 binding matches it. CI builds one per
# platform runner (darwin/linux x arm64/x64). Usage:
#   npm run pack:tarball
set -eu

ROOT="$(dirname "$0")/.."
cd "$ROOT"

VERSION="$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -n 1)"
[ -n "$VERSION" ] || { echo "package.sh: error: could not read version from package.json" >&2; exit 1; }

os_raw="$(uname -s)"
case "$os_raw" in
  Darwin) OS="darwin" ;;
  Linux) OS="linux" ;;
  *) echo "package.sh: error: unsupported OS '$os_raw' (darwin, linux)" >&2; exit 1 ;;
esac
arch_raw="$(uname -m)"
case "$arch_raw" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64|amd64) ARCH="x64" ;;
  *) echo "package.sh: error: unsupported arch '$arch_raw' (arm64, x64)" >&2; exit 1 ;;
esac

ARTIFACT="campfire-$OS-$ARCH.tar.gz"
echo "pack: building campfire v$VERSION for $OS/$ARCH"

npm run build >/dev/null || { echo "package.sh: error: npm run build failed" >&2; exit 1; }

STAGE="$(mktemp -d 2>/dev/null || mktemp -d -t campfire-pack)"
trap 'rm -rf "$STAGE"' EXIT INT TERM
mkdir -p "$STAGE/bin" "$STAGE/lib/campfire/node_modules" release

cp package.json package-lock.json LICENSE "$STAGE/lib/campfire/"
cp -R dist "$STAGE/lib/campfire/dist"

# npm reports the installed production dependency graph, including nested
# packages. Copy only those directories; copying every dev dependency before
# pruning made packaging unnecessarily slow on macOS. This stays offline and
# preserves the host-built better-sqlite3 binding without rebuilding it.
# npm ls prints the canonical path. On a case-insensitive volume, `pwd`
# can differ in case from that path and reject every dependency line.
PROJECT_ROOT="$(node -e 'import { realpathSync } from "node:fs"; console.log(realpathSync("."))')"
npm ls --omit=dev --parseable --all > "$STAGE/production-dependencies" || {
  echo "package.sh: error: could not list installed production dependencies" >&2
  exit 1
}
while IFS= read -r dependency; do
  case "$dependency" in
    "$PROJECT_ROOT") continue ;;
    "$PROJECT_ROOT/node_modules/"*)
      relative="${dependency#"$PROJECT_ROOT/node_modules/"}"
      destination="$STAGE/lib/campfire/node_modules/$relative"
      mkdir -p "$(dirname "$destination")"
      cp -R "$dependency" "$(dirname "$destination")/" || {
        echo "package.sh: error: could not stage production dependency $relative" >&2
        exit 1
      }
      ;;
    *)
      echo "package.sh: error: unexpected dependency path $dependency" >&2
      exit 1
      ;;
  esac
done < "$STAGE/production-dependencies"

# Old release tags predate the optional OpenTUI sidecar. The protected release
# workflow deliberately runs this script against those tags as well, so stage
# the sidecar only when that release source includes it. A present but broken
# install is an error: the packaged CLI must not silently ship without its UI.
if [ -f tui/package.json ]; then
  if [ "$OS" = linux ]; then
    node -e 'const h = process.report?.getReport()?.header; if (typeof h?.glibcVersionRuntime !== "string") process.exit(1);' || {
      echo "package.sh: error: OpenTUI archives currently require glibc on Linux (musl is not supported)" >&2; exit 1;
    }
  fi
  [ -f tui/package-lock.json ] && [ -f tui/src/main.ts ] && [ -d tui/assets ] || {
    echo "package.sh: error: incomplete OpenTUI source" >&2; exit 1;
  }
  TUI_ROOT="$(cd tui && node -e 'import { realpathSync } from "node:fs"; console.log(realpathSync("."))')"
  TUI_DEST="$STAGE/lib/campfire/tui"
  mkdir -p "$TUI_DEST/node_modules"
  cp tui/package.json tui/package-lock.json "$TUI_DEST/"
  cp -R tui/src tui/assets "$TUI_DEST/"
  (cd tui && npm ls --omit=dev --parseable --all) > "$STAGE/tui-dependencies" || {
    echo "package.sh: error: install OpenTUI dependencies with npm ci --prefix tui" >&2; exit 1;
  }
  while IFS= read -r dependency; do
    case "$dependency" in
      "$TUI_ROOT") continue ;;
      "$TUI_ROOT/node_modules/"*)
        relative="${dependency#"$TUI_ROOT/node_modules/"}"
        destination="$TUI_DEST/node_modules/$relative"
        mkdir -p "$(dirname "$destination")"
        cp -R "$dependency" "$(dirname "$destination")/" || {
          echo "package.sh: error: could not stage OpenTUI dependency $relative" >&2; exit 1;
        }
        ;;
      *) echo "package.sh: error: unexpected OpenTUI dependency path $dependency" >&2; exit 1 ;;
    esac
  done < "$STAGE/tui-dependencies"

  # npm's Bun postinstall puts the host binary here; validate the actual staged
  # executable and native renderer, not just the existence of platform names.
  TUI_BUN="$TUI_DEST/node_modules/bun/bin/bun.exe"
  [ -x "$TUI_BUN" ] || { echo "package.sh: error: staged Bun is missing" >&2; exit 1; }
  TUI_BUN_VERSION="$("$TUI_BUN" --version)" || { echo "package.sh: error: staged Bun failed to run" >&2; exit 1; }
  node -e 'const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(process.argv[1]); if (!m || Number(m[1]) < 1 || (Number(m[1]) === 1 && (Number(m[2]) < 3 || (Number(m[2]) === 3 && Number(m[3]) < 14)))) process.exit(1);' "$TUI_BUN_VERSION" || {
    echo "package.sh: error: staged Bun must be at least 1.3.14" >&2; exit 1;
  }
  (unset OPENTUI_LIB_PATH OTUI_ASSET_ROOT OPENTUI_LIBC; cd "$TUI_DEST" && "$TUI_BUN" -e 'import { createTestRenderer } from "@opentui/core/testing"; const t = await createTestRenderer({width: 8, height: 4}); await t.renderOnce(); t.renderer.destroy();') || {
    echo "package.sh: error: staged OpenTUI native renderer failed" >&2; exit 1;
  }
fi

# POSIX sh wrapper: resolves symlinks portably, execs bundled dist with node.
# LIB_DIR must be normalized (no ".." segments): the CLI runs only when
# argv[1] matches import.meta.url exactly, so an un-normalized path would
# silently no-op with exit 0.
cat > "$STAGE/bin/campfire" <<'EOF'
#!/bin/sh
# Campfire CLI entrypoint (installed by install.sh).
set -eu
_target="$0"
while [ -L "$_target" ]; do
  _link="$(ls -ld "$_target")"
  _link="${_link##* -> }"
  case "$_link" in
    /*) _target="$_link" ;;
    *) _target="$(dirname "$_target")/$_link" ;;
  esac
done
LIB_DIR="$(cd "$(dirname "$_target")/.." && pwd)/lib/campfire"
exec node "$LIB_DIR/dist/src/cli/index.js" "$@"
EOF
chmod +x "$STAGE/bin/campfire"

# Smoke-test the staged tree before archiving (require real output: the CLI
# silently exits 0 when argv[1] is not a normalized path, so exit code alone
# proves nothing).
stage_help="$("$STAGE/bin/campfire" --help 2>&1)" || {
  echo "package.sh: error: staged campfire failed '--help'" >&2
  exit 1
}
[ -n "$stage_help" ] || {
  echo "package.sh: error: staged campfire '--help' printed nothing" >&2
  exit 1
}

# Name lib/campfire, not lib. A bare lib/ entry is only a parent directory,
# and older updaters reject any archive path outside bin/ and lib/campfire/.
tar -czf "release/$ARTIFACT" -C "$STAGE" bin lib/campfire || {
  echo "package.sh: error: tar failed" >&2
  exit 1
}

# Select the installed hash tool before computing a digest. On macOS,
# `sha256sum` is usually absent; the old pipeline returned cut's successful
# status and wrote an empty checksum instead of falling back to shasum.
if command -v sha256sum >/dev/null 2>&1; then
  sum_output="$(sha256sum "release/$ARTIFACT")" || {
    echo "package.sh: error: sha256sum failed" >&2
    exit 1
  }
elif command -v shasum >/dev/null 2>&1; then
  sum_output="$(shasum -a 256 "release/$ARTIFACT")" || {
    echo "package.sh: error: shasum failed" >&2
    exit 1
  }
else
  echo "package.sh: error: neither sha256sum nor shasum is available" >&2
  exit 1
fi
sum="${sum_output%% *}"
case "$sum" in
  *[!0-9a-fA-F]*)
    echo "package.sh: error: checksum is not a hex digest" >&2
    exit 1
    ;;
esac
[ "${#sum}" -eq 64 ] || {
  echo "package.sh: error: checksum must contain exactly 64 hex characters" >&2
  exit 1
}
printf '%s  %s\n' "$sum" "$ARTIFACT" > "release/$ARTIFACT.sha256"

# Versioned installer copy for static hosting (/campfire/vX.Y.Z/install.sh).
# Published versions are tracked so the Worker can serve immutable URLs.
versioned_installer="public/campfire/v$VERSION/install.sh"
mkdir -p "public/campfire/v$VERSION"
if [ -f "$versioned_installer" ]; then
  cmp -s public/campfire/install.sh "$versioned_installer" || {
    echo "package.sh: error: $versioned_installer differs from the current installer; refusing to overwrite an immutable version" >&2
    exit 1
  }
else
  cp public/campfire/install.sh "$versioned_installer"
fi

echo "pack: release/$ARTIFACT"
echo "pack: release/$ARTIFACT.sha256 ($sum)"
echo "pack: public/campfire/v$VERSION/install.sh"
echo "pack: publish with: gh release create v$VERSION release/$ARTIFACT release/$ARTIFACT.sha256"
