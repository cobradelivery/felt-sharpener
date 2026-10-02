#!/usr/bin/env bash
# Builds android/felt-sharpener.apk without Gradle, using the Debian/Ubuntu-packaged Android tools:
#   sudo apt-get install aapt apksigner zipalign dalvik-exchange android-sdk-platform-23
# plus a JDK (javac). The web game (index.html, css/, js/) is bundled unchanged into assets/www.
set -euo pipefail
cd "$(dirname "$0")"
ROOT=..
ANDROID_JAR=${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}
KEYSTORE=${KEYSTORE:-felt-sharpener.keystore}
KS_PASS=${KS_PASS:-feltsharpener}
OUT=${OUT:-felt-sharpener.apk}
B=build

rm -rf "$B" && mkdir -p "$B/classes" "$B/assets/www"

echo "• bundling web game"
cp "$ROOT/index.html" "$B/assets/www/"
cp -r "$ROOT/css" "$ROOT/js" "$B/assets/www/"

echo "• compiling Java"
javac -nowarn -Xlint:-options --release 8 -cp "$ANDROID_JAR" -d "$B/classes" $(find src -name '*.java')

echo "• converting to DEX"
dalvik-exchange --dex --min-sdk-version=26 --output="$B/classes.dex" "$B/classes"

echo "• packaging resources + assets"
aapt package -f -0 arsc -M AndroidManifest.xml -S res -A "$B/assets" -I "$ANDROID_JAR" -F "$B/unaligned.apk"
(cd "$B" && aapt add -f unaligned.apk classes.dex >/dev/null)

echo "• aligning"
zipalign -f -p 4 "$B/unaligned.apk" "$B/aligned.apk"

if [ ! -f "$KEYSTORE" ]; then
  echo "• creating signing key ($KEYSTORE)"
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KS_PASS" -keypass "$KS_PASS" -alias felt \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Felt Sharpener, O=Felt Sharpener" >/dev/null 2>&1
fi

echo "• signing"
apksigner sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" --ks-key-alias felt --out "$OUT" "$B/aligned.apk"
apksigner verify --print-certs "$OUT" | head -1
ls -l "$OUT"
