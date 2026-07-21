# StackUp — Mobile App Plan (Google Play & App Store)

The plan to ship StackUp as a real native app — what's built, what it costs,
everything needed, and the order to do it in. This follows the same proven
workflow used for TallyPay.

---

## Three ways to be "an app"

| Approach | What it actually is | Stores | Effort | Verdict |
| --- | --- | --- | --- | --- |
| **TWA** | Thin Android shell around the live site. | Google Play only | days | Apple rejects pure web wrappers |
| **Capacitor** *(built)* | Native Android (and later iOS) app running the existing StackUp, plus real device features (push, biometrics, camera, share). | Both | ~2–4 weeks total | ★ **Chosen** |
| **Full native rewrite** (React Native / Flutter) | Rebuild every screen in native code — a second product to maintain. | Both | 3–6+ months | Overkill |

### Why Capacitor

StackUp is already a polished web product. Capacitor wraps **that exact app** in
a genuine native project and lets us add the native features that make it feel
like an app — not a rewrite, not a second codebase. Web content keeps
auto-updating on every deploy; we only re-release the store build when the
native shell itself changes.

---

## Architecture

1. **StackUp web app** *(exists)* — the single-origin deploy (API serves the
   web). Unchanged.
2. **Capacitor native shell** *(built — `mobile/`)* — a real Android project
   rendering the app full-screen and brokering device access.
3. **Native capability plugins** — status bar + splash *(in)*; push, biometric
   unlock, camera, share sheet *(next)*.
4. **Output** — an installable debug `.apk` (now) and a signed `.aab` for Play
   (once signing keys exist).

---

## Native features to add next

- **Push notifications** — task assigned, comment/@mention, due-date reminders
  (FCM; needs a free Firebase project).
- **Biometric unlock** — fingerprint / face.
- **Native share sheet** — share a task/doc link to WhatsApp, email, SMS.
- **Camera & photos** — snap a photo straight into a task attachment.
- **Deep links** — StackUp URLs open inside the app.

---

## Accounts, tools & fees

| Requirement | For | Who | Cost |
| --- | --- | --- | --- |
| Google Play Developer | Publishing on Play | You | **$25 once** |
| Apple Developer Program | App Store + push; yearly | You (later) | **$99 / yr** |
| Mac for iOS builds | Apple requires macOS to build/sign iOS | Decision (later) | $0–$1/hr cloud |
| Firebase project | Push delivery (FCM) | Set up together | Free |
| Build CI (GitHub Actions) | Auto-build the app | Done | Free |
| Signing keys | App identity | You keep, guided | Free |

Android needs no Mac. iOS is deferred until Android is live.

---

## Roadmap

| Phase | Status | Work |
| --- | --- | --- |
| **0 — Groundwork** | ✅ Done | PWA manifest, icons, service worker (M15); live single-origin deploy. |
| **1 — Native shell** | ✅ Done | Capacitor Android project; loads the live app; branded splash, status bar, icons; CI builds a debug APK on demand. |
| **2 — Signing & install** | ⏳ You | Generate the upload keystore (2 commands, `mobile/README.md`), add the 4 secrets → CI produces the Play-ready `.aab`. Debug APK is installable today. |
| **3 — Native features** | Next | Push (Firebase), biometric unlock, share sheet, camera, deep links. |
| **4 — Compliance & assets** | Next | Account-deletion URL, ToS, screenshots, feature graphic, listing copy, Data-safety form. |
| **5 — Beta → Launch** | Later | Play Internal Testing → production (review ~1–3 days). |
| **6 — iOS** | Later | `cap add ios`, cloud-Mac build, TestFlight → App Store. |

---

## What's needed from you to reach the Play Store

1. **Enroll in Google Play Developer** ($25 once) — verification can take a
   day or two, so start early.
2. **Generate the signing keystore** (guided — two commands) and add the four
   repo secrets.
3. **Confirm listing basics** — app name ("StackUp"), short + full description,
   category (Productivity), support email.

Everything else — code, config, CI, store assets from the brand — is handled.
