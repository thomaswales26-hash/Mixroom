#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/.build/macos"
APP="$BUILD/Mixroom.app"
STAGE="$BUILD/pkgroot"
VERSION="1.0.4"

rm -rf "$APP" "$STAGE" "$BUILD/Mixroom-arm64" "$BUILD/Mixroom-x86_64"
mkdir -p "$BUILD" "$APP/Contents/MacOS" "$APP/Contents/Resources/Web"
cp "$ROOT/macos/Info.plist" "$APP/Contents/Info.plist"
cp -X "$ROOT/index.html" "$ROOT/styles.css" "$ROOT/app.js" "$APP/Contents/Resources/Web/"

SDK="$(xcrun --sdk macosx --show-sdk-path)"
swiftc -O -sdk "$SDK" -target arm64-apple-macosx13.0 \
  -framework AppKit -framework WebKit \
  "$ROOT/macos/MixroomApp.swift" -o "$BUILD/Mixroom-arm64"
swiftc -O -sdk "$SDK" -target x86_64-apple-macosx13.0 \
  -framework AppKit -framework WebKit \
  "$ROOT/macos/MixroomApp.swift" -o "$BUILD/Mixroom-x86_64"
lipo -create "$BUILD/Mixroom-arm64" "$BUILD/Mixroom-x86_64" \
  -output "$APP/Contents/MacOS/Mixroom"

codesign --force --deep --sign - "$APP"
mkdir -p "$STAGE/Applications"
ditto --norsrc --noextattr "$APP" "$STAGE/Applications/Mixroom.app"
pkgbuild \
  --root "$STAGE" \
  --identifier com.mixroom.app \
  --version "$VERSION" \
  --install-location / \
  "$ROOT/Mixroom-$VERSION-macOS.pkg"

echo "Built $ROOT/Mixroom-$VERSION-macOS.pkg"
