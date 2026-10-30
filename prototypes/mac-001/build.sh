#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
OUTPUT=${1:-/tmp/campfire-mac-001}
APP="$OUTPUT/Campfire MAC-001.app"
mkdir -p "$APP/Contents/MacOS"
mkdir -p "$OUTPUT/swift-module-cache" "$OUTPUT/clang-module-cache"
CLANG_MODULE_CACHE_PATH="$OUTPUT/clang-module-cache" \
  xcrun swiftc -parse-as-library -target arm64-apple-macos13.0 \
  -module-cache-path "$OUTPUT/swift-module-cache" -framework SwiftUI \
  "$ROOT/CampfireReadOnly.swift" -o "$APP/Contents/MacOS/CampfireReadOnly"
cp "$ROOT/Info.plist" "$APP/Contents/Info.plist"
codesign --force --sign - "$APP"
echo "$APP"
