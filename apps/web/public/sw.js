/* StackUp service worker (M15) — offline shell + runtime caching.
 *
 * Strategy:
 *   - Precache the offline fallback page on install.
 *   - Navigations: network-first, falling back to the cache then /offline.html
 *     so the app opens even with no connection.
 *   - Same-origin static assets (_next, icons, css/js): stale-while-revalidate.
 *   - API calls (cross-origin to :3000, or /api/): never cached — always live.
 */
const VERSION = "stackup-v1";
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

  // Never intercept API traffic — it must always be live and authenticated.
  const isApi =
    url.pathname.startsWith("/api/") ||
    url.port === "3000" ||
    req.headers.get("accept")?.includes("text/event-stream");
  if (isApi) return;

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

  // Same-origin static assets: stale-while-revalidate.
  if (url.origin === self.location.origin) {
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
