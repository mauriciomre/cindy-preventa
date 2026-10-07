// Instalación como app (PWA): registra el service worker, guarda el aviso de
// instalación del navegador y muestra un banner arriba de todo.
//  - Chrome/Edge/Android: "Instalar" dispara el cartel nativo.
//  - iPhone (Safari no tiene esa API): a los 20 s aparece "Ver cómo" con la guía.
// Si lo cierran no vuelve por 14 días; si ya está instalada, no se muestra.
(function () {
    var KEY = "preventa_install_dismissed_at";
    var DIAS = 14;
    var deferred = null;

    function ls(op, k, v) {
        try {
            return op === "get" ? localStorage.getItem(k) : localStorage.setItem(k, v);
        } catch (e) {
            return null;
        }
    }
    function standalone() {
        return (
            (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
            window.navigator.standalone === true
        );
    }
    function descartado() {
        var t = parseInt(ls("get", KEY) || "0", 10);
        return t && Date.now() - t < DIAS * 86400000;
    }
    var ua = navigator.userAgent || "";
    var esIOS = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

    if ("serviceWorker" in navigator) {
        window.addEventListener("load", function () {
            navigator.serviceWorker.register("sw.js").catch(function () {});
        });
    }

    var SVG = function (body) {
        return '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + "</svg>";
    };
    var I = {
        download: SVG('<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>'),
        x: SVG('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
        share: SVG('<path d="M12 2v13"/><path d="m16 6-4-4-4 4"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>'),
        plus: SVG('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 12h8"/><path d="M12 8v8"/>'),
        dots: SVG('<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>'),
    };

    function banner() {
        if (document.getElementById("installBanner") || standalone() || descartado()) return;
        var b = document.createElement("div");
        b.className = "install-banner";
        b.id = "installBanner";
        b.innerHTML =
            '<div class="install-banner-txt"><strong>Instalá la app</strong><span>Entrá más rápido a las preventas desde tu pantalla de inicio.</span></div>' +
            '<button type="button" class="install-banner-btn" id="installBtn">' +
            (deferred ? I.download + " Instalar" : "Ver cómo") +
            "</button>" +
            '<button type="button" class="install-banner-x" id="installX" aria-label="Cerrar">' + I.x + "</button>";
        document.body.insertBefore(b, document.body.firstChild);
        document.getElementById("installBtn").onclick = instalar;
        document.getElementById("installX").onclick = function () {
            ls("set", KEY, String(Date.now()));
            b.remove();
        };
    }

    function quitarBanner() {
        var b = document.getElementById("installBanner");
        if (b) b.remove();
    }

    function instalar() {
        if (deferred) {
            var d = deferred;
            deferred = null;
            d.prompt();
            d.userChoice.then(quitarBanner);
        } else {
            abrirGuia();
        }
    }

    var PASOS = {
        iphone: [
            [I.share, "Tocá el botón <b>Compartir</b> en la barra de Safari."],
            [I.plus, "Elegí <b>Agregar a inicio</b>."],
            [I.download, "Confirmá con <b>Agregar</b>. Listo, queda como una app más."],
        ],
        android: [
            [I.dots, "Abrí el menú de tres puntos de Chrome (arriba a la derecha)."],
            [I.download, "Elegí <b>Instalar app</b> o <b>Agregar a la pantalla principal</b>."],
            [I.plus, "Confirmá con <b>Instalar</b>."],
        ],
        compu: [
            [I.download, "En Chrome o Edge, buscá el ícono de <b>instalar</b> al final de la barra de direcciones."],
            [I.plus, "Hacé clic en <b>Instalar</b>. Se abre en su propia ventana."],
        ],
    };

    function abrirGuia() {
        if (document.getElementById("installGuide")) return;
        var tab = esIOS ? "iphone" : /android/i.test(ua) ? "android" : "compu";
        var g = document.createElement("div");
        g.className = "install-guide-bg";
        g.id = "installGuide";
        g.onclick = function (e) {
            if (e.target === g) g.remove();
        };
        g.innerHTML =
            '<div class="install-guide" role="dialog" aria-modal="true" aria-label="Cómo instalar la app">' +
            '<div class="install-guide-head"><span>Instalar la app</span><button type="button" aria-label="Cerrar" id="igClose">' + I.x + "</button></div>" +
            '<div class="install-tabs" id="igTabs">' +
            '<button data-t="iphone">iPhone</button><button data-t="android">Android</button><button data-t="compu">Compu</button></div>' +
            '<ol class="install-steps" id="igSteps"></ol></div>';
        document.body.appendChild(g);
        function pintar(t) {
            document.querySelectorAll("#igTabs button").forEach(function (b) {
                b.classList.toggle("on", b.getAttribute("data-t") === t);
            });
            document.getElementById("igSteps").innerHTML = PASOS[t]
                .map(function (p) {
                    return '<li><span class="install-step-ic">' + p[0] + "</span><span>" + p[1] + "</span></li>";
                })
                .join("");
        }
        document.querySelectorAll("#igTabs button").forEach(function (b) {
            b.onclick = function () {
                pintar(b.getAttribute("data-t"));
            };
        });
        document.getElementById("igClose").onclick = function () {
            g.remove();
        };
        pintar(tab);
    }

    window.addEventListener("beforeinstallprompt", function (e) {
        e.preventDefault();
        deferred = e;
        quitarBanner();
        banner();
    });
    window.addEventListener("appinstalled", quitarBanner);

    if (esIOS && !standalone() && !descartado()) {
        setTimeout(banner, 20000);
    }
    window.abrirGuiaInstalar = abrirGuia;
})();
