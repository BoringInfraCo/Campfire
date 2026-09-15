#!/bin/sh
# Build the versioned campfire release tarball for the current host.
#
# POSIX sh. Produces, for GitHub Releases:
#   release/campfire-{os}-{arch}.tar.gz
#   release/campfire-{os}-{arch}.tar.gz.sha256
# plus a versioned copy of the installer for static hosting:
#   public/campfire/vX.Y.Z/install.sh   (gitignored build output)
#
# Tarball layout (mirrors the install prefix):
#   bin/campfire                        POSIX sh wrapper (node + bundled lib)
#   lib/campfire/{dist,package.json,package-lock.json,LICENSE,node_modules}
#
# node_modules is pruned to production deps in a staging dir, so the native
# better-sqlite3 binding matches the build host. CI builds one tarball per
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
mkdir -p "$STAGE/bin" "$STAGE/lib/campfire" release

cp package.json package-lock.json LICENSE "$STAGE/lib/campfire/"
cp -R dist "$STAGE/lib/campfire/dist"
cp -R node_modules "$STAGE/lib/campfire/node_modules"

# Prune to production deps inside staging only (never touches the worktree).
# Works offline: it only deletes, using the existing tree + lockfile.
(cd "$STAGE/lib/campfire" && npm prune --omit=dev --no-audit --no-fund) || {
  echo "package.sh: error: npm prune --omit=dev failed" >&2
  exit 1
}

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

tar -czf "release/$ARTIFACT" -C "$STAGE" bin lib || {
  echo "package.sh: error: tar failed" >&2
  exit 1
}

(cd release && { sha256sum "$ARTIFACT" | cut -d ' ' -f 1 > "$ARTIFACT.sum" 2>/dev/null || shasum -a 256 "$ARTIFACT" | cut -d ' ' -f 1 > "$ARTIFACT.sum"; }) || {
  echo "package.sh: error: checksum failed" >&2
  exit 1
}
sum="$(cat "release/$ARTIFACT.sum")"
printf '%s  %s\n' "$sum" "$ARTIFACT" > "release/$ARTIFACT.sha256"
rm -f "release/$ARTIFACT.sum"

# Versioned installer copy for static hosting (/campfire/vX.Y.Z/install.sh).
# Gitignored build output; the release workflow deploys public/ as-is.
mkdir -p "public/campfire/v$VERSION"
cp public/campfire/install.sh "public/campfire/v$VERSION/install.sh"

echo "pack: release/$ARTIFACT"
echo "pack: release/$ARTIFACT.sha256 ($sum)"
echo "pack: public/campfire/v$VERSION/install.sh"
echo "pack: publish with: gh release create v$VERSION release/$ARTIFACT release/$ARTIFACT.sha256"
