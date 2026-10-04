#!/usr/bin/env bash
# Builds android/felt-sharpener.apk without Gradle, using the Debian/Ubuntu-packaged Android tools:
#   sudo apt-get install aapt apksigner zipalign dalvik-exchange android-sdk-platform-23
# plus a JDK (javac). The web game (index.html, css/, js/) is bundled unchanged into assets/www.
set -euo pipefail
cd "$(dirname "$0")"
ROOT=..
ANDROID_JAR=${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}
# Signing key: NEVER committed. Supply it with KEYSTORE=/path/to/key.keystore and KS_PASS=... (or put
# android/release.keystore + android/release.keystore.pass next to this script; both are git-ignored).
KEYSTORE=${KEYSTORE:-release.keystore}
if [ -z "${KS_PASS:-}" ] && [ -f "$KEYSTORE.pass" ]; then KS_PASS=$(tr -d '\r\n' < "$KEYSTORE.pass"); fi
if [ ! -f "$KEYSTORE" ] || [ -z "${KS_PASS:-}" ]; then
  cat >&2 <<MSG
No signing key. Set KEYSTORE and KS_PASS, or place android/release.keystore and android/release.keystore.pass.
To create a new key (only if you have never installed an APK signed with your existing one):
  keytool -genkeypair -keystore android/release.keystore -alias felt -keyalg RSA -keysize 2048 -validity 10000 \\
          -dname "CN=Felt Sharpener" -storepass "\$(openssl rand -base64 24 | tee android/release.keystore.pass)"
Keep the key and password safe and private: every future update must be signed with the same key.
MSG
  exit 1
fi
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


echo "• signing"
apksigner sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" --ks-key-alias felt --out "$OUT" "$B/aligned.apk"
apksigner verify --print-certs "$OUT" | head -1
ls -l "$OUT"
