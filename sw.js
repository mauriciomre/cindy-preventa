// Service worker mínimo: hace que el navegador considere la app instalable.
// A propósito NO cachea nada — el catálogo muestra stock en vivo y un caché
// viejo podría mostrar productos agotados como disponibles.
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", function () {});
