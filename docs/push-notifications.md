# Push notifications (FCM)

StackUp can send phone alerts — "New mention", "Task assigned to you" — via
**Firebase Cloud Messaging (FCM)**. It ships **dormant**: everything is wired,
but nothing sends until you connect a Firebase project. No code changes are
needed to turn it on.

## What's already built

- **Device registration** — the Android app asks for notification permission
  and stores its FCM token (`POST /push/tokens`, per user, pruned when stale).
- **Sender** — the API signs a service-account JWT and calls the FCM HTTP v1
  API directly. No-op until configured.
- **Trigger** — creating an in-app notification (mention, assignment, …) also
  pushes to the user's registered devices; tapping the notification deep-links
  into the right screen.
- **Android plugin** — `@capacitor/push-notifications` in `mobile/`, with the
  Android 13+ `POST_NOTIFICATIONS` permission declared.

## Turn it on — one-time Firebase setup

### 1. Create the Firebase project + Android app
1. <https://console.firebase.google.com> → **Add project** → name it
   "StackUp" (Analytics optional).
2. **Add app → Android**. Package name **`com.stackup.app`** (exact). Register.
3. Download the real **`google-services.json`**.

### 2. Put the config in the app (receiving)
Replace the placeholder at `mobile/android/app/google-services.json` with the
real file, commit, and rebuild the APK (Actions → *Build mobile app (Android)*).
Reinstall — this build can receive pushes. *(The committed placeholder only
exists so the app keeps building before this step.)*

### 3. Give the server permission to send
1. Firebase console → **Project settings → Service accounts → Generate new
   private key** → downloads a JSON file.
2. In **Render → Environment**, add `FCM_SERVICE_ACCOUNT` = the entire JSON on
   one line (or base64 of it — both accepted). Save; Render redeploys and the
   API starts sending.

## Test it
Install the rebuilt app, open it once (accept the notification prompt), then
have a teammate @mention you in a task comment. The phone should get the push.

## Notes
- Until steps 2 and 3 are both done, push is inert — the app builds and runs
  normally.
- Invalid/expired device tokens are pruned automatically when FCM rejects them.
- iOS later: add an iOS app in Firebase + an APNs key, then `npx cap add ios`.
