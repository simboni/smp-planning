/**
 * Native bridge — Capacitor integrations for the StackUp Android shell.
 *
 * The shell loads the live site and injects `window.Capacitor`; an inline
 * script in layout.tsx marks the document with data-app="native" before
 * paint so CSS can swap the desktop chrome for the mobile app shell. All
 * Capacitor plugins are loaded via dynamic import() inside handlers guarded
 * by isNativeApp(), so the web bundle stays clean and every function is a
 * safe no-op in a normal browser.
 */

import {
  authApi,
  clearTokens,
  pushApi,
  setIdentityToken,
  setRefreshToken,
  setUser,
} from "@/lib/api";

declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
    };
  }
}

/** True when running inside the Capacitor shell (not the plain web app). */
export function isNativeApp(): boolean {
  return (
    typeof window !== "undefined" &&
    window.Capacitor?.isNativePlatform?.() === true
  );
}

/* ---- share --------------------------------------------------------- */

/**
 * Share via the native sheet when in the app, else the Web Share API.
 * Returns false when neither is available (caller falls back to copy).
 */
export async function share(opts: {
  title?: string;
  text?: string;
  url?: string;
}): Promise<boolean> {
  if (isNativeApp()) {
    try {
      const { Share } = await import("@capacitor/share");
      await Share.share(opts);
      return true;
    } catch {
      return false; // cancelled or unavailable
    }
  }
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share(opts);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/* ---- haptics ------------------------------------------------------- */

/** Tactile feedback for key taps; a silent no-op on the web. */
export async function haptic(kind: "light" | "medium" | "success"): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { Haptics, ImpactStyle, NotificationType } = await import(
      "@capacitor/haptics"
    );
    if (kind === "success") {
      await Haptics.notification({ type: NotificationType.Success });
    } else {
      await Haptics.impact({
        style: kind === "light" ? ImpactStyle.Light : ImpactStyle.Medium,
      });
    }
  } catch {
    /* haptics are best-effort */
  }
}

/* ---- status bar ---------------------------------------------------- */

/**
 * Match the Android status bar to the app theme. The bar overlays the
 * webview; the app bar pads itself down with --su-safe-top.
 */
export async function syncStatusBar(theme: "light" | "dark"): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setOverlaysWebView({ overlay: true }).catch(() => undefined);
    await StatusBar.setStyle({
      style: theme === "dark" ? Style.Dark : Style.Light,
    });
    await StatusBar.setBackgroundColor({
      color: theme === "dark" ? "#0e0f14" : "#ffffff",
    });
  } catch {
    /* status bar is cosmetic */
  }
}

/* ---- hardware back button ------------------------------------------ */

let backButtonWired = false;

/** Android back: pop history when there is any, else minimize the app. */
export async function initBackButton(_router: { back: () => void }): Promise<void> {
  if (!isNativeApp() || backButtonWired) return;
  backButtonWired = true;
  try {
    const { App } = await import("@capacitor/app");
    await App.addListener("backButton", () => {
      if (window.history.length > 1) window.history.back();
      else void App.minimizeApp();
    });
  } catch {
    backButtonWired = false;
  }
}

/* ---- deep links (native Google SSO) -------------------------------- */

let deepLinksWired = false;

/**
 * Handle com.stackup.app://sso#… deep links: the OAuth callback redirects
 * to the custom scheme with tokens (or an sso_error) in the fragment.
 */
export async function initDeepLinks(): Promise<void> {
  if (!isNativeApp() || deepLinksWired) return;
  deepLinksWired = true;
  try {
    const { App } = await import("@capacitor/app");
    await App.addListener("appUrlOpen", ({ url }) => {
      if (!url.startsWith("com.stackup.app://sso")) return;
      const hash = url.split("#")[1] ?? "";
      const params = new URLSearchParams(hash);

      const err = params.get("sso_error");
      if (err) {
        window.location.replace(`/login#sso_error=${encodeURIComponent(err)}`);
        return;
      }

      const identityToken = params.get("identityToken");
      const refreshToken = params.get("refreshToken");
      if (!identityToken || !refreshToken) return;
      clearTokens();
      setIdentityToken(identityToken);
      setRefreshToken(refreshToken);
      authApi
        .me()
        .then((r) => setUser(r.user))
        .catch(() => undefined)
        .finally(() => window.location.replace("/select"));
    });
  } catch {
    deepLinksWired = false;
  }
}

/* ---- push notifications -------------------------------------------- */

let pushWired = false;

/**
 * Ask for permission, register with FCM, and post the device token to the
 * API. Tapping a notification with a `path` in its data deep-links there.
 * Call only when native AND logged in.
 */
export async function registerPush(): Promise<void> {
  if (!isNativeApp() || pushWired) return;
  pushWired = true;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");

    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== "granted") return;

    await PushNotifications.addListener("registration", (token) => {
      pushApi
        .register({ token: token.value, platform: "android" })
        .catch(() => undefined);
    });

    await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      const data = action.notification.data as { path?: unknown } | undefined;
      const path = data?.path;
      if (typeof path === "string" && path.startsWith("/")) {
        window.location.href = path;
      }
    });

    await PushNotifications.register();
  } catch {
    pushWired = false; // allow a retry on next init
  }
}

/* ---- camera -------------------------------------------------------- */

/**
 * Take a photo (or pick one — the OS prompt offers both). Returns base64
 * data ready for the attachments upload API, or null when cancelled/web.
 */
export async function capturePhoto(): Promise<{
  base64: string;
  mime: string;
  name: string;
} | null> {
  if (!isNativeApp()) return null;
  try {
    const { Camera, CameraResultType, CameraSource } = await import(
      "@capacitor/camera"
    );
    const photo = await Camera.getPhoto({
      resultType: CameraResultType.Base64,
      source: CameraSource.Prompt,
      quality: 80,
    });
    if (!photo.base64String) return null;
    const format = photo.format === "jpg" ? "jpeg" : photo.format || "jpeg";
    return {
      base64: photo.base64String,
      mime: `image/${format}`,
      name: `photo-${Date.now()}.${photo.format || "jpeg"}`,
    };
  } catch {
    return null; // cancelled
  }
}
