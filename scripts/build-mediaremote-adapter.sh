#!/usr/bin/env bash
# Run: bash scripts/build-mediaremote-adapter.sh   (on a Mac with Xcode Command Line Tools and CMake)
# Builds mediaremote-adapter (BSD-3-Clause, https://github.com/ungive/mediaremote-adapter), which
# reads macOS now playing, into pc-companion/src-tauri/mediaremote/ for the macOS release bundle
# (src-tauri/tauri.macos-release.conf.json). MEDIAREMOTE_FULL_TEST=1 also runs the adapter's own
# end-to-end test, which needs a logged-in session.
# The adapter needs macOS 11 (UniformTypeIdentifiers). On 10.15 Freeze runs without now playing.
set -euo pipefail

version=v0.7.7
commit=e3ff5021eb0875858bd05f48d2e9ba2e962d1cf6

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/pc-companion/src-tauri/mediaremote"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

git clone --quiet --depth 1 --branch "$version" https://github.com/ungive/mediaremote-adapter.git "$work/src"
if [ "$(git -C "$work/src" rev-parse HEAD)" != "$commit" ]; then
  echo "Tag $version no longer points at $commit; check the upstream release before updating" >&2
  exit 1
fi
# Without a deployment target the library would only load on this Mac's macOS version or newer.
cmake -S "$work/src" -B "$work/build" -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0 > /dev/null
cmake --build "$work/build" --target MediaRemoteAdapter MediaRemoteAdapterTestClient > /dev/null

rm -rf "$out"
mkdir -p "$out"
# The app ships the library under a plain name (a .framework folder inside the app's Resources would
# be taken for nested code at signing); Freeze rebuilds the framework layout when it installs it.
cp -L "$work/build/MediaRemoteAdapter.framework/MediaRemoteAdapter" "$out/MediaRemoteAdapter.dylib"
cp "$work/src/bin/mediaremote-adapter.pl" "$work/src/LICENSE" "$out/"
codesign --force --sign - "$out/MediaRemoteAdapter.dylib"
lipo "$out/MediaRemoteAdapter.dylib" -verify_arch arm64 x86_64
minos="$(vtool -show-build "$out/MediaRemoteAdapter.dylib" | awk '/minos/ { print $2 }' | sort -u)"
if [ "$minos" != "11.0" ]; then
  echo "MediaRemoteAdapter.dylib must target macOS 11.0, but targets: $minos" >&2
  exit 1
fi

# Check the library loads in the system perl the way Freeze runs it.
framework="$work/check/MediaRemoteAdapter.framework"
mkdir -p "$framework"
cp "$out/MediaRemoteAdapter.dylib" "$framework/MediaRemoteAdapter"
/usr/bin/perl "$out/mediaremote-adapter.pl" "$framework" get --no-artwork > /dev/null
if [ "${MEDIAREMOTE_FULL_TEST:-}" = 1 ]; then
  if /usr/bin/perl "$out/mediaremote-adapter.pl" "$framework" "$work/build/MediaRemoteAdapterTestClient" test; then
    echo "MediaRemote access works on this Mac"
  else
    echo "::warning::The adapter's MediaRemote test failed on this Mac"
  fi
fi
echo "Built mediaremote-adapter $version into $out"
