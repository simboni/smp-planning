/* StackUp service worker (M15) — offline shell + runtime caching.
 *
 * Strategy:
 *   - Precache the offline fallback page on install.
 *   - Navigations: network-first, falling back to the cache then /offline.html
 *     so the app opens even with no connection.
 *   - Same-origin static assets (_next, icons, css/js): stale-while-revalidate.
 *   - API calls (cross-origin to :3000, or /api/): never cached — always live.
 */
const VERSION = "stackup-v2";
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll([OFFLINE_URL])),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.startsWith(VERSION))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Never intercept live API traffic — it must always be fresh and
  // authenticated. In single-origin deploys the API shares this origin, so we
  // never cache by path prefix; instead we ONLY cache known static assets
  // below and let everything else (API JSON, SSE) pass straight to network.
  const isEventStream = req.headers.get("accept")?.includes("text/event-stream");
  if (isEventStream) return;

  // App navigations: network-first with an offline fallback.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          return cached || caches.match(OFFLINE_URL);
        }),
    );
    return;
  }

  // Same-origin STATIC assets only (build output + public files):
  // stale-while-revalidate. API responses share this origin in single-origin
  // deploys, so we allowlist by asset shape and never cache anything else —
  // API JSON falls through to a normal, uncached network fetch.
  const isStatic =
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/") ||
      /\.(?:js|css|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|eot|webmanifest|txt)$/.test(
        url.pathname,
      ));
  if (isStatic) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
  }
});
