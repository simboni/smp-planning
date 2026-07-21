# StackUp — mobile app (Capacitor)

The native Android app shell for StackUp, built with **Capacitor**. It wraps the
live app (`https://app.stackup.co.ke`) in a real native app and is the
base we add native features onto (push notifications, biometric unlock, share
sheet). Web content auto-updates on every deploy of the web app; we only
re-release the store build when the native shell itself changes.

## How to get the app file

GitHub Actions builds it — you don't need Android tooling locally:

1. Repo **Actions** tab → **Build mobile app (Android)** → **Run workflow**
   (it also runs automatically when anything under `mobile/` changes).
2. Open the finished run → **Artifacts**:
   - **`stackup-debug-apk`** → `app-debug.apk`, installable on any phone now
     (allow "install unknown apps" when prompted).
   - **`stackup-release`** → Play-ready signed `.aab` + `.apk` (once signing
     secrets are set — see below).

## Signing (for the Play-ready build)

Create an upload keystore once and keep it forever (the same key must sign every
future update):

```bash
keytool -genkeypair -v -keystore stackup-upload.keystore \
  -alias stackup -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 stackup-upload.keystore
```

Add repo secrets: `ANDROID_KEYSTORE_BASE64` (the base64 output),
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`stackup`),
`ANDROID_KEY_PASSWORD`; re-run the workflow.

## Local development

```bash
cd mobile
npm ci
npx cap sync android      # regenerates native config + plugin refs
npx cap open android      # opens Android Studio (needs the Android SDK)
```

`node_modules` and Capacitor's generated native files are gitignored; CI
restores them with `npm ci` + `npx cap sync android` before building, so the
committed `android/` project always builds from a clean checkout.

## Config

- **`capacitor.config.json`** — app id `com.stackup.app`, name StackUp,
  `server.url` → the live web app, StackUp-purple splash + status bar.
  If the production URL ever changes, update `server.url` and re-release.
- **`www/index.html`** — a branded fallback shown only if the live app is
  unreachable; normally the remote app loads immediately.
- Launcher icons + splash are rendered from the StackUp stack mark
  (brand `#7B68EE`).

## Version / name

Bump `versionCode` (and `versionName`) in `android/app/build.gradle` for every
Play upload. Change the display name in
`android/app/src/main/res/values/strings.xml`.

## Roadmap (next)

- **Native features**: `@capacitor/push-notifications` (needs a Firebase
  project + `google-services.json`), biometric unlock, `@capacitor/camera`.
- **iOS**: `npx cap add ios` + a macOS/cloud-Mac build (Android first).
