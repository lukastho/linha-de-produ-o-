// Service worker simples: cache do "app shell" para o tablet abrir mesmo sem rede.
// Estrategia:
//  - navegacao (HTML): rede primeiro, cai para o cache se a rede falhar
//  - assets estaticos: cache primeiro, atualiza em segundo plano
//  - chamadas ao Supabase: NUNCA sao cacheadas (dados precisam ser reais)

const CACHE = "montagem-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.hostname.endsWith("supabase.co")) return; // dados sempre da rede

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).catch(() => caches.match("/index.html"))
    );
    return;
  }

  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req).then((hit) => {
        const rede = fetch(req).then((res) => {
          if (res && res.status === 200) {
            const copia = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copia));
          }
          return res;
        }).catch(() => hit);
        return hit || rede;
      })
    );
  }
});
