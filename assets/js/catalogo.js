var API_URL = "api.php";
var WA_NUM = "5493534140385";
var products = [],
    cart = {},
    activeCat = "TODOS",
    activePreventa = "TODAS",
    query = "",
    viewMode = "grid",
    sortMode = "default";

// ── CARRITO PERSISTENTE ───────────────────────────────────────────────────────
function saveCart() {
    try {
        localStorage.setItem("tb_cart", JSON.stringify(cart));
    } catch (e) {}
}
function loadCart() {
    try {
        var saved = localStorage.getItem("tb_cart");
        if (saved) cart = JSON.parse(saved);
    } catch (e) {
        cart = {};
    }
}
loadCart();

fetch(API_URL + "?action=config_get")
    .then(function (r) {
        return r.json();
    })
    .then(function (cfg) {
        if (cfg.whatsapp) WA_NUM = cfg.whatsapp;
    })
    .catch(function () {});

var lazyObs = null;
if (window.IntersectionObserver) {
    lazyObs = new IntersectionObserver(
        function (entries) {
            entries.forEach(function (e) {
                if (e.isIntersecting) {
                    var img = e.target,
                        src = img.getAttribute("data-src");
                    if (src) {
                        img.src = src;
                        img.removeAttribute("data-src");
                    }
                    lazyObs.unobserve(img);
                }
            });
        },
        { rootMargin: "200px" },
    );
}

function activateLazy() {
    if (!lazyObs) {
        document.querySelectorAll("img[data-src]").forEach(function (i) {
            i.src = i.getAttribute("data-src") || "";
        });
        return;
    }
    document.querySelectorAll("img[data-src]").forEach(function (i) {
        lazyObs.observe(i);
    });
}

function getImgSrc(p) {
    var v = p.UPDATED_AT || Date.now();
    if (p.FOTO && p.FOTO.indexOf("http") === 0) return p.FOTO + "?v=" + v;
    if (p.FOTO) return p.FOTO + "?v=" + v;
    return "imgs/" + (p.CODIGO || "").replace(/\//g, "_") + ".jpeg" + "?v=" + v;
}

// ── Lightbox de foto de producto (grilla, tabla y modal de colores) ────────
// La animación "crece desde la miniatura" se arma a mano con un solo <img>
// compartido (#lightboxImg, en index.html): se lo para primero exacto en el
// rect de la miniatura clickeada (sin transición) y recién en el frame
// siguiente se le anima top/left/width/height al tamaño grande — closeLightbox
// hace el camino inverso antes de ocultar. Sin esto (aplicar el tamaño final
// de una) se vería un fundido genérico, no la miniatura "creciendo".
var lightboxOriginRect = null;

function openLightbox(imgEl) {
    // Sin foto real todavía (rota / no cargó) no hay nada que agrandar.
    if (!imgEl.src || imgEl.naturalWidth === 0) return;
    var bg = document.getElementById("lightboxBg");
    var img = document.getElementById("lightboxImg");
    var rect = imgEl.getBoundingClientRect();
    lightboxOriginRect = rect;

    img.src = imgEl.src;
    img.style.transition = "none";
    img.style.top = rect.top + "px";
    img.style.left = rect.left + "px";
    img.style.width = rect.width + "px";
    img.style.height = rect.height + "px";
    bg.style.transition = "none";
    bg.style.backgroundColor = "rgba(10,8,6,0)";
    bg.classList.add("open");

    // Forzar reflow antes de animar — si no, el navegador puede fusionar el
    // estado inicial y el final en un solo paso y no se ve ningún movimiento.
    void img.offsetWidth;

    lbResetZoom();

    requestAnimationFrame(function () {
        var target = lightboxTargetRect();
        img.style.transition = "top .3s cubic-bezier(.2,.8,.2,1), left .3s cubic-bezier(.2,.8,.2,1), width .3s cubic-bezier(.2,.8,.2,1), height .3s cubic-bezier(.2,.8,.2,1)";
        bg.style.transition = "background-color .3s ease";
        bg.style.backgroundColor = "rgba(10,8,6,.85)";
        img.style.top = target.top + "px";
        img.style.left = target.left + "px";
        img.style.width = target.width + "px";
        img.style.height = target.height + "px";
        // Base para el cálculo de zoom/pan — el rect "grande" final, no el
        // de la miniatura de origen (ese ya cumplió su función acá).
        lbBaseRect = target;
    });
}

function lightboxTargetRect() {
    var w = Math.min(window.innerWidth * 0.92, 640);
    var h = Math.min(window.innerHeight * 0.8, 640);
    return {
        top: (window.innerHeight - h) / 2,
        left: (window.innerWidth - w) / 2,
        width: w,
        height: h,
    };
}

function closeLightbox() {
    var bg = document.getElementById("lightboxBg");
    if (!bg.classList.contains("open")) return;
    var img = document.getElementById("lightboxImg");
    var r = lightboxOriginRect;
    lbResetZoom();
    bg.style.backgroundColor = "rgba(10,8,6,0)";
    if (r) {
        img.style.top = r.top + "px";
        img.style.left = r.left + "px";
        img.style.width = r.width + "px";
        img.style.height = r.height + "px";
    }
    setTimeout(function () {
        bg.classList.remove("open");
        lightboxOriginRect = null;
    }, 300);
}

document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeLightbox();
});

// ── Zoom / paneo dentro del lightbox ────────────────────────────────────────
// Todo vía CSS transform (translate+scale) sobre el mismo #lightboxImg, en
// paralelo con la animación de apertura/cierre (que mueve top/left/width/
// height — propiedades distintas, no chocan). lbBaseRect es el rect "grande"
// ya calculado en openLightbox — el zoom/paneo se mide siempre contra ese
// rect fijo, nunca contra getBoundingClientRect() en vivo (que ya incluye el
// transform actual y daría un cálculo circular).
var lbZoom = 1,
    lbPanX = 0,
    lbPanY = 0,
    lbBaseRect = null;
var lbPointers = {};
var lbPinchStartDist = 0,
    lbPinchStartZoom = 1;
var lbDragStart = null;
var lbLastTapTime = 0,
    lbLastTapX = 0,
    lbLastTapY = 0;

function lbApplyTransform() {
    var img = document.getElementById("lightboxImg");
    img.style.transform = "translate(" + lbPanX + "px," + lbPanY + "px) scale(" + lbZoom + ")";
    img.classList.toggle("zoomed", lbZoom > 1);
}

function lbClampPan() {
    if (!lbBaseRect) return;
    var maxX = (lbBaseRect.width * (lbZoom - 1)) / 2;
    var maxY = (lbBaseRect.height * (lbZoom - 1)) / 2;
    lbPanX = Math.max(-maxX, Math.min(maxX, lbPanX));
    lbPanY = Math.max(-maxY, Math.min(maxY, lbPanY));
}

// clientX/clientY es el punto (mouse, dedo, o punto medio del pellizco) que
// tiene que quedar fijo en pantalla mientras cambia el zoom — sin esto,
// cada pellizco/scroll "saltaría" el punto de interés en vez de acercarlo.
function lbZoomAt(newZoom, clientX, clientY) {
    if (!lbBaseRect) return;
    newZoom = Math.max(1, Math.min(4, newZoom));
    var cx = lbBaseRect.left + lbBaseRect.width / 2;
    var cy = lbBaseRect.top + lbBaseRect.height / 2;
    var relX = clientX - cx,
        relY = clientY - cy;
    var origX = (relX - lbPanX) / lbZoom;
    var origY = (relY - lbPanY) / lbZoom;
    lbPanX = relX - newZoom * origX;
    lbPanY = relY - newZoom * origY;
    lbZoom = newZoom <= 1.02 ? 1 : newZoom;
    if (lbZoom === 1) {
        lbPanX = 0;
        lbPanY = 0;
    }
    lbClampPan();
    lbApplyTransform();
}

function lbResetZoom() {
    lbZoom = 1;
    lbPanX = 0;
    lbPanY = 0;
    lbBaseRect = null;
    lbPointers = {};
    lbDragStart = null;
    lbApplyTransform();
}

function lbToggleZoom(clientX, clientY) {
    lbZoomAt(lbZoom > 1 ? 1 : 2.5, clientX, clientY);
}

function lbInitZoomHandlers() {
    var img = document.getElementById("lightboxImg");

    img.addEventListener("wheel", function (e) {
        if (lbZoom === 1 && e.deltaY > 0) return; // ya está en 1:1, dejar scrollear la página si hiciera falta
        e.preventDefault();
        lbZoomAt(lbZoom * (1 - e.deltaY * 0.0015), e.clientX, e.clientY);
    }, { passive: false });

    img.addEventListener("pointerdown", function (e) {
        lbPointers[e.pointerId] = { x: e.clientX, y: e.clientY };
        // Capturar SIEMPRE el puntero al target, no solo cuando arranca un
        // arrastre — sin esto, en un pellizco de 2 dedos apenas uno se
        // despega visualmente del área de la foto (algo casi inevitable al
        // separarlos) el navegador deja de mandarle sus pointermove al
        // <img> y el pellizco se queda "trabado" a mitad de gesto en mobile
        // (bug real reportado por Mauricio — no pasaba en desktop porque el
        // mouse no se "sale" del elemento de la misma forma). Va en un
        // try/catch: si por lo que sea falla, no tiene que tirar abajo el
        // resto de la lógica de seguimiento del pellizco.
        try { img.setPointerCapture(e.pointerId); } catch (err) {}
        var ids = Object.keys(lbPointers);
        if (ids.length === 2) {
            var p1 = lbPointers[ids[0]], p2 = lbPointers[ids[1]];
            lbPinchStartDist = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
            lbPinchStartZoom = lbZoom;
            lbDragStart = null;
            return;
        }
        // Doble tap (solo touch/pen — el mouse ya tiene su propio "dblclick"
        // más abajo; si contara acá también, un doble click de mouse
        // alternaría el zoom dos veces y quedaría como si no hubiera pasado
        // nada).
        if (e.pointerType !== "mouse") {
            var now = Date.now();
            if (now - lbLastTapTime < 300 && Math.hypot(e.clientX - lbLastTapX, e.clientY - lbLastTapY) < 30) {
                lbToggleZoom(e.clientX, e.clientY);
                lbLastTapTime = 0;
                return;
            }
            lbLastTapTime = now;
            lbLastTapX = e.clientX;
            lbLastTapY = e.clientY;
        }
        if (lbZoom > 1) {
            lbDragStart = { x: e.clientX, y: e.clientY, panX: lbPanX, panY: lbPanY };
        }
    });

    img.addEventListener("pointermove", function (e) {
        if (!(e.pointerId in lbPointers)) return;
        lbPointers[e.pointerId] = { x: e.clientX, y: e.clientY };
        var ids = Object.keys(lbPointers);
        if (ids.length === 2) {
            var p1 = lbPointers[ids[0]], p2 = lbPointers[ids[1]];
            var dist = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
            lbZoomAt(lbPinchStartZoom * (dist / lbPinchStartDist), (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
        } else if (ids.length === 1 && lbDragStart) {
            lbPanX = lbDragStart.panX + (e.clientX - lbDragStart.x);
            lbPanY = lbDragStart.panY + (e.clientY - lbDragStart.y);
            lbClampPan();
            lbApplyTransform();
        }
    });

    function lbPointerEnd(e) {
        delete lbPointers[e.pointerId];
        lbDragStart = null;
        var ids = Object.keys(lbPointers);
        if (ids.length === 1 && lbZoom > 1) {
            // Quedó un dedo apoyado (se levantó uno de un pellizco de a dos)
            // — retomar el paneo desde ahí en vez de cortarlo en seco.
            var p = lbPointers[ids[0]];
            lbDragStart = { x: p.x, y: p.y, panX: lbPanX, panY: lbPanY };
        }
    }
    img.addEventListener("pointerup", lbPointerEnd);
    img.addEventListener("pointercancel", lbPointerEnd);

    img.addEventListener("dblclick", function (e) {
        e.preventDefault();
        lbToggleZoom(e.clientX, e.clientY);
    });
}
lbInitZoomHandlers();

function setView(v) {
    viewMode = v;
    document.getElementById("btnGrid").classList.toggle("on", v === "grid");
    document.getElementById("btnList").classList.toggle("on", v === "list");
    renderProds();
}

function setSort(v) {
    sortMode = v;
    document.querySelectorAll(".sort-btn").forEach(function (b) {
        b.classList.toggle("on", b.dataset.sort === v);
    });
    renderProds();
}

function renderSkeleton() {
    var html = '<div class="grid">';
    for (var i = 0; i < 12; i++) {
        html += '<div class="card skeleton-card">';
        html += '<div class="skeleton-img"></div>';
        html += '<div class="card-body">';
        html += '<div class="skeleton-line sk-short"></div>';
        html += '<div class="skeleton-line sk-long"></div>';
        html += '<div class="skeleton-line sk-medium"></div>';
        html += '<div class="skeleton-line sk-btn"></div>';
        html += "</div></div>";
    }
    html += "</div>";
    document.getElementById("prods").innerHTML = html;
}

function start() {
    renderSkeleton();
    fetch(API_URL + "?action=productos&t=" + Date.now())
        .then(function (r) {
            if (!r.ok) throw new Error();
            return r.json();
        })
        .then(function (data) {
            products = data.map(function (p) {
                return {
                    CODIGO: p.codigo,
                    DESCRIPCION: p.descripcion,
                    CATEGORIA: p.categoria,
                    PRECIO_MAYORISTA: p.precio_mayorista,
                    MARCA: p.marca || null,
                    FOTO: p.foto,
                    ESTADO: p.estado,
                    ORDEN: p.orden,
                    MULTIPLO: parseInt(p.multiplo) || 1,
                    STOCK_PREVENTA: parseInt(p.stock_preventa) || 0,
                    STOCK_PREVENTA_INICIAL: parseInt(p.stock_preventa_inicial) || 0,
                    CODIGO_BARRAS: p.codigo_barras || null,
                    CAT_ORDEN: p.cat_orden || 0,
                    PREVENTA_ID: p.preventa_id || null,
                    PREVENTA_NOMBRE: p.preventa_nombre || null,
                    PREVENTA_DETALLE: p.preventa_detalle || null,
                    PREVENTA_IMAGEN: p.preventa_imagen || null,
                    PREVENTA_IMAGEN_V: p.preventa_imagen_v || 0,
                    PREVENTA_ORDEN: p.preventa_orden != null ? Number(p.preventa_orden) : 0,
                    PREVENTA_MOSTRAR_STOCK: String(p.preventa_mostrar_stock) === "1",
                    UPDATED_AT: p.updated_at
                        ? new Date(p.updated_at).getTime()
                        : Date.now(),
                    CREATED_AT: p.created_at
                        ? new Date(p.created_at).getTime()
                        : 0,
                    COLORES: p.colores || [],
                };
            });
            // Limpiar items del carrito que ya no existen en los productos
            Object.keys(cart).forEach(function (code) {
                var found = products.find(function (p) {
                    return p.CODIGO === code;
                });
                if (found) {
                    cart[code].p = found;
                } // actualizar referencia con datos frescos
                else {
                    delete cart[code];
                }
            });
            saveCart();
            render();
            updateCart();
        })
        .catch(function () {
            document.getElementById("prods").innerHTML =
                '<div class="loading">Error al cargar. Intentá recargar la página.</div>';
        });
}

// Productos ya acotados a la preventa activa (o a todas) — la categoría es
// un filtro secundario que corre sobre este subconjunto, no sobre el
// catálogo completo.
function productsInPreventa() {
    if (activePreventa === "TODAS") return products;
    return products.filter(function (p) {
        return String(p.PREVENTA_ID) === String(activePreventa);
    });
}

function getCats() {
    // Orden de categorías según cat_orden, calculado sobre la preventa activa
    var seen = {},
        cats = [];
    productsInPreventa().forEach(function (p) {
        if (p.CATEGORIA && !seen[p.CATEGORIA]) {
            seen[p.CATEGORIA] = 1;
            cats.push({ nombre: p.CATEGORIA, orden: p.CAT_ORDEN });
        }
    });
    cats.sort(function (a, b) {
        return a.orden - b.orden;
    });
    return ["TODOS"].concat(
        cats.map(function (c) {
            return c.nombre;
        }),
    );
}

// Lista de preventas activas con productos visibles, en el orden en que
// deben aparecer los carteles (mismo "orden" que se define en el admin).
function getPreventas() {
    var seen = {}, list = [];
    products.forEach(function (p) {
        if (p.PREVENTA_ID && !seen[p.PREVENTA_ID]) {
            seen[p.PREVENTA_ID] = 1;
            list.push({
                id: p.PREVENTA_ID,
                nombre: p.PREVENTA_NOMBRE,
                detalle: p.PREVENTA_DETALLE,
                imagen: p.PREVENTA_IMAGEN,
                imagen_v: p.PREVENTA_IMAGEN_V,
                orden: p.PREVENTA_ORDEN,
            });
        }
    });
    list.sort(function (a, b) { return a.orden - b.orden || a.nombre.localeCompare(b.nombre); });
    return list;
}

function setPreventa(id) {
    clearHighlight();
    activePreventa = id;
    activeCat = "TODOS";
    renderPreventaSelector();
    renderTabs();
    renderProds();
}

function renderPreventaSelector() {
    var wrap = document.getElementById("preventaSelector");
    var outer = document.getElementById("preventaSelectorOuter");
    if (!wrap || !outer) return;
    var preventas = getPreventas();
    if (!preventas.length) { wrap.innerHTML = ""; outer.style.display = "none"; return; }
    outer.style.display = "";
    // "Todas las preventas" va primera (es el default y la opción más
    // usada) y con color de marca bien visible — antes quedaba al final,
    // blanca, la menos llamativa de toda la fila.
    var html =
        '<button class="prev-card prev-card-all' + (activePreventa === "TODAS" ? " on" : "") + '" onclick="setPreventa(\'TODAS\')">' +
        '<span class="prev-card-name">Todas las preventas</span></button>';
    preventas.forEach(function (pv) {
        // ?v=<updated_at> como cache-buster — el archivo se llama siempre
        // igual (preventa_<id>.jpeg), así que sin esto el navegador seguía
        // mostrando la portada vieja después de subir una nueva.
        var bg = pv.imagen ? 'style="background-image:url(\'' + pv.imagen + '?v=' + (pv.imagen_v || 0) + '\')"' : "";
        html +=
            '<button class="prev-card' + (String(activePreventa) === String(pv.id) ? " on" : "") + (pv.imagen ? " has-img" : "") + '" ' + bg +
            ' onclick="setPreventa(\'' + pv.id + '\')">' +
            '<span class="prev-card-text"><span class="prev-card-name">' + pv.nombre + "</span>" +
            (pv.detalle ? '<span class="prev-card-detalle">' + pv.detalle + "</span>" : "") +
            "</span></button>";
    });
    wrap.innerHTML = html;
    updatePrevSelectorFade();
    wrap.onscroll = updatePrevSelectorFade;
    window.addEventListener("resize", updatePrevSelectorFade);
}

// Sin scrollbar visible, la única pista de que hay más preventas para el
// costado es este degradado con flecha — se esconde solo si ya se scrolleó
// hasta el final, o si todo entra sin hacer falta scrollear.
function updatePrevSelectorFade() {
    var wrap = document.getElementById("preventaSelector");
    var outer = document.getElementById("preventaSelectorOuter");
    if (!wrap || !outer) return;
    var atEnd = wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 2;
    outer.classList.toggle("at-end", atEnd);
}

// Click en la flecha del degradado — antes era solo decorativa
// (pointer-events:none), así que tocarla no hacía nada. Ahora es un botón
// real que avanza el scroll una pantalla (menos un poco, para que se note
// que sigue la fila anterior).
function scrollPrevSelector() {
    var wrap = document.getElementById("preventaSelector");
    if (!wrap) return;
    wrap.scrollBy({ left: wrap.clientWidth - 60, behavior: "smooth" });
}

function render() {
    renderPreventaSelector();
    renderTabs();
    renderProds();
}

function renderTabs() {
    var cats = getCats();
    // Tabs desktop
    document.getElementById("tabs").innerHTML = cats
        .map(function (c) {
            return (
                '<button class="tab' +
                (c === activeCat ? " on" : "") +
                '" onclick="setTab(\'' +
                c +
                "')\">" +
                c +
                "</button>"
            );
        })
        .join("");
    // Dropdown mobile
    document.getElementById("catDropdownLabel").textContent =
        "CATEGORÍA: " + activeCat;
    document.getElementById("catDropdownMenu").innerHTML = cats
        .map(function (c) {
            return (
                '<div class="cat-dropdown-item' +
                (c === activeCat ? " on" : "") +
                '" onclick="setTabDropdown(\'' +
                c +
                "')\">" +
                c +
                "</div>"
            );
        })
        .join("");
}

function toggleCatDropdown() {
    document.getElementById("catDropdownMenu").classList.toggle("open");
}

function setTabDropdown(c) {
    document.getElementById("catDropdownMenu").classList.remove("open");
    setTab(c);
}

// Cerrar dropdown al tocar fuera
document.addEventListener("click", function (e) {
    var wrap = document.getElementById("catDropdownWrap");
    if (wrap && !wrap.contains(e.target)) {
        var menu = document.getElementById("catDropdownMenu");
        if (menu) menu.classList.remove("open");
    }
});

function setTab(c) {
    clearHighlight();
    activeCat = c;
    renderTabs();
    renderProds();
}
function doSearch() {
    clearHighlight();
    query = document.getElementById("srch").value.toLowerCase().trim();
    renderProds();
}

// ── Highlight persistente tras escaneo ────────────────────────────
var highlightedCard = null;
var highlightScrollRef = 0;
var HIGHLIGHT_SCROLL_THRESHOLD = 80;  // px para considerar "scrolleó manualmente"

function clearHighlight() {
    if (highlightedCard) {
        highlightedCard.classList.remove("barcode-flash");
        highlightedCard = null;
    }
    window.removeEventListener("scroll", onHighlightScroll, { passive: true });
}

function onHighlightScroll() {
    if (Math.abs(window.scrollY - highlightScrollRef) >= HIGHLIGHT_SCROLL_THRESHOLD) {
        clearHighlight();
    }
}

function setHighlight(card) {
    clearHighlight();   // limpia cualquier highlight previo primero
    highlightedCard = card;
    card.classList.add("barcode-flash");
    // Adjuntamos el listener DESPUÉS de que termine el scroll animado de scrollIntoView
    // (que dura ~600 ms). Si lo adjuntamos antes, el propio scroll programático
    // dispara onHighlightScroll y borra el highlight al instante.
    setTimeout(function () {
        if (highlightedCard !== card) return;  // fue limpiado mientras esperábamos
        highlightScrollRef = window.scrollY;
        window.addEventListener("scroll", onHighlightScroll, { passive: true });
    }, 700);
}

// Handler para el lector de código de barras (funciona como teclado: escribe el código y Enter)
function doSearchEnter(e) {
    if (e.key !== "Enter") return;
    var val = (document.getElementById("srch").value || "").trim();
    if (!val) return;
    // Buscar coincidencia exacta por código de barras o código de producto
    var exact = products.find(function (p) {
        return (p.CODIGO_BARRAS && p.CODIGO_BARRAS === val) ||
               (p.CODIGO && p.CODIGO.toLowerCase() === val.toLowerCase());
    });
    if (exact) {
        // Filtro off + mostramos ese producto
        query = "";
        document.getElementById("srch").value = "";
        activeCat = "TODOS";
        renderTabs();
        renderProds();
        // Scroll + highlight persistente
        setTimeout(function () {
            var card = document.querySelector('[data-codigo="' + exact.CODIGO + '"]');
            if (!card) return;
            card.scrollIntoView({ behavior: "smooth", block: "center" });
            setHighlight(card);
        }, 80);
    } else {
        // No hay exacto: dejar el filtro de texto corriente (ya renderizado por oninput)
        clearHighlight();
        doSearch();
    }
}

function getVisible() {
    var list = productsInPreventa().filter(function (p) {
        var catOk = activeCat === "TODOS" || p.CATEGORIA === activeCat;
        var srchOk =
            !query ||
            (p.DESCRIPCION || "").toLowerCase().indexOf(query) >= 0 ||
            (p.CODIGO || "").toLowerCase().indexOf(query) >= 0 ||
            (p.CODIGO_BARRAS || "").toLowerCase().indexOf(query) >= 0;
        return catOk && srchOk;
    });

    // Ordenamiento
    if (sortMode === "newest") {
        list = list.slice().sort(function (a, b) {
            return b.CREATED_AT - a.CREATED_AT;
        });
    } else if (sortMode === "alpha") {
        list = list.slice().sort(function (a, b) {
            return a.DESCRIPCION.localeCompare(b.DESCRIPCION);
        });
    } else if (sortMode === "price_asc") {
        list = list.slice().sort(function (a, b) {
            return (
                parseFloat(a.PRECIO_MAYORISTA) - parseFloat(b.PRECIO_MAYORISTA)
            );
        });
    } else if (sortMode === "price_desc") {
        list = list.slice().sort(function (a, b) {
            return (
                parseFloat(b.PRECIO_MAYORISTA) - parseFloat(a.PRECIO_MAYORISTA)
            );
        });
    }
    // default: mantiene el orden de la BD (por orden y categoria)

    return list;
}

function fmt(v) {
    //   = espacio irrompible entre "$" y el monto — nunca se corta en
    // dos líneas en un contenedor angosto ("$" arriba, monto abajo).
    return "$ " + Math.round(parseFloat(v) || 0).toLocaleString("es-AR");
}
function sid(code) {
    return "p" + code.replace(/[^a-zA-Z0-9]/g, "_");
}
function getQty(code) {
    return cart[code] ? cart[code].qty : getMultiplo(code);
}
function getMultiplo(code) {
    var p = products.find(function (x) {
        return x.CODIGO === code;
    });
    return p ? p.MULTIPLO || 1 : 1;
}

// Stock de preventa cargado a mano (no viene de Manager) para no sobrevender
// mercadería que todavía no llegó. 0 = sin tope, entra como lista de espera.
function isWaitlist(code) {
    var p = products.find(function (x) {
        return x.CODIGO === code;
    });
    return !p || (p.STOCK_PREVENTA || 0) <= 0;
}
function getStockCap(code) {
    var p = products.find(function (x) {
        return x.CODIGO === code;
    });
    if (!p) return Infinity;
    var s = p.STOCK_PREVENTA || 0;
    return s > 0 ? s : Infinity;
}

// ── Variantes de color (solo del lado de la app, no vienen de Manager) ──────
// El stock sigue siendo del artículo principal (STOCK_PREVENTA), no por
// color — acá solo se reparte cuánto de esa cantidad total va de cada color,
// para que el depósito sepa qué preparar. cart[code].colores es
// {nombreColor: cantidad}, con las entradas en 0 omitidas.
function getColorQty(code, colorNombre) {
    var c = cart[code];
    return c && c.colores ? c.colores[colorNombre] || 0 : 0;
}

function colorQtyRowsHTML(p) {
    var multiplo = p.MULTIPLO || 1;
    var html = '<div class="color-qty-rows">';
    p.COLORES.forEach(function (c, idx) {
        var q = getColorQty(p.CODIGO, c.nombre);
        html +=
            '<div class="color-qty-row">' +
            '<span class="color-qty-info"><span class="color-dot" style="background:' + c.hex + '"></span>' +
            '<span class="color-qty-name">' + esc(c.nombre) + '</span></span>' +
            '<div class="qty qty-sm">' +
            '<button class="qb" onclick="chgColorQty(\'' + p.CODIGO + "'," + idx + ',-1)">−</button>' +
            '<input class="qn" type="number" id="cq_' + sid(p.CODIGO) + '_' + idx +
            '" value="' + q + '" min="0" step="' + multiplo +
            '" onchange="manualColorQty(\'' + p.CODIGO + "'," + idx + ',this.value)" ' +
            'onblur="manualColorQty(\'' + p.CODIGO + "'," + idx + ',this.value)">' +
            '<button class="qb" onclick="chgColorQty(\'' + p.CODIGO + "'," + idx + ',1)">+</button>' +
            "</div></div>";
    });
    html += "</div>";
    return html;
}

function esc(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;");
}

// Suma las cantidades de todos los inputs de color de un producto (0 si
// todavía no se tocó ninguno) — no toca el carrito, solo lee el DOM.
function sumColorInputs(code) {
    var p = products.find(function (x) { return x.CODIGO === code; });
    if (!p || !p.COLORES) return { total: 0, colores: {} };
    var total = 0, colores = {};
    p.COLORES.forEach(function (c, idx) {
        var el = document.getElementById("cq_" + sid(code) + "_" + idx);
        var q = el ? parseInt(el.value) || 0 : 0;
        if (q > 0) { colores[c.nombre] = q; total += q; }
    });
    return { total: total, colores: colores };
}

function chgColorQty(code, idx, delta) {
    var p = products.find(function (x) { return x.CODIGO === code; });
    if (!p) return;
    var multiplo = p.MULTIPLO || 1;
    var el = document.getElementById("cq_" + sid(code) + "_" + idx);
    if (!el) return;
    var next = Math.max(0, (parseInt(el.value) || 0) + delta * multiplo);
    el.value = next;
    syncColorCartIfPresent(code);
    updateColorPickerUI(code);
}

function manualColorQty(code, idx, val) {
    var p = products.find(function (x) { return x.CODIGO === code; });
    if (!p) return;
    var multiplo = p.MULTIPLO || 1;
    var num = Math.max(0, parseInt(val) || 0);
    var snapped = num === 0 ? 0 : Math.max(multiplo, Math.round(num / multiplo) * multiplo);
    var el = document.getElementById("cq_" + sid(code) + "_" + idx);
    if (el) el.value = snapped;
    syncColorCartIfPresent(code);
    updateColorPickerUI(code);
}

// Si el producto ya está en el carrito, cada edición de un color actualiza
// la cantidad total en vivo (mismo comportamiento que la cantidad simple).
function syncColorCartIfPresent(code) {
    if (!cart[code]) return;
    var r = sumColorInputs(code);
    var cap = getStockCap(code);
    if (cap !== Infinity && r.total > cap) {
        toastCarrito("El total (" + r.total + ") supera el stock disponible (" + cap + ")", "#c62828");
        // Revertir todos los inputs de color de este producto al valor que
        // ya tenía en el carrito (no sabemos cuál de los inputs se tocó).
        var p = products.find(function (x) { return x.CODIGO === code; });
        if (p && p.COLORES) {
            p.COLORES.forEach(function (c, idx) {
                var el = document.getElementById("cq_" + sid(code) + "_" + idx);
                if (el) el.value = cart[code].colores[c.nombre] || 0;
            });
        }
        return;
    }
    cart[code].qty = r.total;
    cart[code].colores = r.colores;
    refreshColorTriggerButton(code);
    updateCart();
}

function addOrUpdateColores(code) {
    var p = products.find(function (x) { return x.CODIGO === code; });
    if (!p) return;
    var r = sumColorInputs(code);
    if (r.total === 0) {
        toastCarrito("Elegí al menos un color y una cantidad", "#c62828");
        return;
    }
    var cap = getStockCap(code);
    if (cap !== Infinity && r.total > cap) {
        toastCarrito("El total (" + r.total + ") supera el stock disponible (" + cap + ")", "#c62828");
        return;
    }
    cart[code] = { p: p, qty: r.total, colores: r.colores };
    refreshColorTriggerButton(code);
    var card = document.getElementById(sid(code));
    if (card) card.classList.add("picked");
    var row = document.getElementById("lr_" + sid(code));
    if (row) row.classList.add("picked-row");
    saveCart();
    updateCart();
}

// Deja el botón "Elegir colores" / "En pedido · N u." de la card (grid) y
// de la fila de tabla (list) reflejando el estado actual del carrito —
// se reusa al agregar, al editar cantidades en vivo y al quitar.
function refreshColorTriggerButton(code) {
    var btn = document.getElementById("ab_" + sid(code));
    if (!btn) return;
    var c = cart[code];
    btn.classList.toggle("on", !!c);
    btn.innerHTML = c
        ? icon("check") + ' En pedido <span style="font-weight:600;opacity:.85">· ' + c.qty + " u.</span>"
        : icon("palette") + " Elegir colores";
}

function removeColorProduct(code, closeFn) {
    if (!code) return;
    rmCart(code);
    refreshColorTriggerButton(code);
    if (closeFn) closeFn(code);
}

function confirmColorPicker(code, closeFn) {
    if (!code) return;
    if (cart[code]) {
        // Ya se sincronizó en vivo con cada cambio — solo cerrar.
        closeFn(code);
        return;
    }
    addOrUpdateColores(code);
    if (cart[code]) closeFn(code);
}

// ── Panel "Elegir colores" dentro de la card (desktop) ──────────────────────
// Va como hermano de .card-body (no adentro) para poder tapar la card
// entera al abrir, imagen incluida — da lugar de sobra para varias filas
// de color sin scroll. Sin cambiar el alto de la card — ver .color-panel
// en catalogo.css. En mobile no se genera (ver isMobileGrid en cardHTML),
// ahí se usa el modal global (openColorModal más abajo).
function colorPanelHTML(p) {
    var id = sid(p.CODIGO);
    return (
        '<div class="color-panel" id="cpanel_' + id + '">' +
        '<div class="color-panel-head">' +
        '<span class="color-panel-title">' + esc(p.DESCRIPCION) + "</span>" +
        '<button class="color-panel-close" onclick="closeColorPanel(\'' + p.CODIGO + '\')" aria-label="Cerrar">' +
        icon("x", { size: 13 }) +
        "</button>" +
        "</div>" +
        '<div class="color-panel-rows">' + colorQtyRowsHTML(p) + "</div>" +
        '<div class="color-panel-foot">' +
        '<button class="color-panel-remove" id="cpremove_' + id + '" onclick="removeColorProduct(\'' + p.CODIGO + "', closeColorPanel)\">Quitar del pedido</button>" +
        '<span class="color-panel-total" id="cptotal_' + id + '">Elegí una cantidad</span>' +
        '<button class="color-panel-confirm" id="cpconfirm_' + id + '" onclick="confirmColorPicker(\'' + p.CODIGO + "', closeColorPanel)\">Confirmar</button>" +
        "</div>" +
        "</div>"
    );
}

function openColorPanel(code) {
    var panel = document.getElementById("cpanel_" + sid(code));
    if (!panel) return;
    // Solo una card expandida a la vez.
    document.querySelectorAll(".color-panel.open").forEach(function (el) {
        if (el !== panel) el.classList.remove("open");
    });
    panel.classList.add("open");
    var removeBtn = document.getElementById("cpremove_" + sid(code));
    if (removeBtn) removeBtn.style.display = cart[code] ? "" : "none";
    updateColorPanelTotal(code);
}

function closeColorPanel(code) {
    var panel = document.getElementById("cpanel_" + sid(code));
    if (panel) panel.classList.remove("open");
}

function updateColorPanelTotal(code) {
    var id = sid(code);
    var totalEl = document.getElementById("cptotal_" + id);
    var btn = document.getElementById("cpconfirm_" + id);
    if (!totalEl || !btn) return;
    var r = sumColorInputs(code);
    totalEl.textContent = r.total > 0 ? r.total + " unidad" + (r.total === 1 ? "" : "es") : "Elegí una cantidad";
    btn.textContent = cart[code] ? "Listo" : "Confirmar" + (r.total > 0 ? " (" + r.total + ")" : "");
}

// ── Modal "Elegir colores" (mobile) — markup fijo en index.html ────────────
var colorModalCode = null;

function openColorModal(code) {
    var p = products.find(function (x) { return x.CODIGO === code; });
    if (!p) return;
    colorModalCode = code;
    document.getElementById("cmImg").src = getImgSrc(p);
    document.getElementById("cmImg").alt = p.DESCRIPCION;
    document.getElementById("cmName").textContent = p.DESCRIPCION;
    document.getElementById("cmPrice").innerHTML = fmt(p.PRECIO_MAYORISTA) + ' <span class="iva">+ IVA</span>';
    document.getElementById("cmRows").innerHTML = colorQtyRowsHTML(p);
    document.getElementById("cmRemoveBtn").style.display = cart[code] ? "" : "none";
    updateColorModalTotal();
    document.getElementById("cmBg").classList.add("open");
}

function closeColorModal() {
    document.getElementById("cmBg").classList.remove("open");
    colorModalCode = null;
}

function updateColorModalTotal() {
    if (!colorModalCode) return;
    var r = sumColorInputs(colorModalCode);
    var totalEl = document.getElementById("cmTotal");
    var btn = document.getElementById("cmConfirmBtn");
    totalEl.textContent = r.total > 0 ? r.total + " unidad" + (r.total === 1 ? "" : "es") : "Elegí una cantidad";
    btn.textContent = cart[colorModalCode] ? "Listo" : "Confirmar" + (r.total > 0 ? " (" + r.total + ")" : "");
}

function confirmColorModal() {
    confirmColorPicker(colorModalCode, closeColorModal);
}

// Actualiza el panel (desktop) y/o el modal (mobile) si corresponde al
// producto que se está editando — no hace nada si ninguno de los dos está
// mostrando ese código (llamarla siempre desde chgColorQty/manualColorQty
// es más simple que rastrear cuál de las dos superficies está activa).
function updateColorPickerUI(code) {
    updateColorPanelTotal(code);
    if (colorModalCode === code) updateColorModalTotal();
}

// Ajusta cantidad al múltiplo más cercano y la limita al stock de preventa
// cargado (si hay stock cargado); sin stock cargado, no hay tope de cantidad.
function snapToMultiplo(qty, multiplo, code) {
    if (multiplo <= 1) qty = Math.max(1, qty);
    else qty = Math.max(multiplo, Math.round(qty / multiplo) * multiplo);
    if (code) {
        var cap = getStockCap(code);
        if (cap !== Infinity && qty > cap) {
            qty = Math.max(multiplo, Math.floor(cap / multiplo) * multiplo || cap);
        }
    }
    return qty;
}

function renderProds() {
    var list = getVisible();
    var el = document.getElementById("prods");
    if (!list.length) {
        el.innerHTML =
            '<div class="loading">No hay productos que coincidan.</div>';
        return;
    }

    // Barra de ordenamiento
    var sortBar =
        '<div class="sort-bar">' +
        '<span class="sort-lbl">Ordenar:</span>' +
        '<button class="sort-btn' +
        (sortMode === "default" ? " on" : "") +
        '" data-sort="default" onclick="setSort(\'default\')">Por defecto</button>' +
        '<button class="sort-btn' +
        (sortMode === "newest" ? " on" : "") +
        '" data-sort="newest" onclick="setSort(\'newest\')">Más nuevo</button>' +
        '<button class="sort-btn' +
        (sortMode === "alpha" ? " on" : "") +
        '" data-sort="alpha" onclick="setSort(\'alpha\')">A ' + icon("arrow-right", {size: 13}) + ' Z</button>' +
        '<button class="sort-btn' +
        (sortMode === "price_asc" ? " on" : "") +
        '" data-sort="price_asc" onclick="setSort(\'price_asc\')">$ ' + icon("arrow-up", {size: 13}) + '</button>' +
        '<button class="sort-btn' +
        (sortMode === "price_desc" ? " on" : "") +
        '" data-sort="price_desc" onclick="setSort(\'price_desc\')">$ ' + icon("arrow-down", {size: 13}) + '</button>' +
        "</div>";

    if (viewMode === "grid") renderGrid(list, el, sortBar);
    else renderList(list, el, sortBar);
}

function renderGrid(list, el, sortBar) {
    // Si está en TODOS y es orden por defecto, agrupar por categoría
    var useGroups = activeCat === "TODOS" && sortMode === "default";
    var html = sortBar;

    if (useGroups) {
        var bycat = {},
            order = [];
        list.forEach(function (p) {
            if (!bycat[p.CATEGORIA]) {
                bycat[p.CATEGORIA] = [];
                order.push(p.CATEGORIA);
            }
            bycat[p.CATEGORIA].push(p);
        });
        order.forEach(function (cat) {
            html +=
                '<div class="cat-title">' + cat + '</div><div class="grid">';
            bycat[cat].forEach(function (p) {
                html += cardHTML(p);
            });
            html += "</div>";
        });
    } else {
        html += '<div class="grid">';
        list.forEach(function (p) {
            html += cardHTML(p);
        });
        html += "</div>";
    }

    el.innerHTML = html;
    setTimeout(activateLazy, 30);
}

function cardHTML(p) {
    var sold = (p.ESTADO || "").toUpperCase() === "AGOTADO";
    var waitlist = !sold && isWaitlist(p.CODIGO);
    var inCart = !!cart[p.CODIGO];
    var qty = getQty(p.CODIGO);
    var multiplo = p.MULTIPLO || 1;
    var cap = getStockCap(p.CODIGO);
    var id = sid(p.CODIGO);
    var src = getImgSrc(p);
    var html =
        '<div class="card' +
        (sold ? " sold" : "") +
        (inCart ? " picked" : "") +
        '" id="' +
        id +
        '" data-codigo="' + p.CODIGO + '">';
    html +=
        '<div class="card-img"><img data-src="' +
        src +
        '" alt="' +
        p.DESCRIPCION +
        '" onclick="openLightbox(this)" onerror="this.style.display=\'none\'"></div>';
    html += '<div class="card-body">';
    html +=
        '<div class="c-top"><span class="code">' +
        p.CODIGO +
        "</span>" +
        (sold ? '<span class="badge">AGOTADO</span>' : "") +
        "</div>";
    if (activePreventa === "TODAS" && p.PREVENTA_NOMBRE)
        html += '<div class="badge-preventa">' + p.PREVENTA_NOMBRE + "</div>";
    var hasColores = p.COLORES && p.COLORES.length > 0;

    // Bloque de info (nombre/marca/precio/stock) — con colores y stock, se
    // arma aparte para poder ponerlo al lado del botón "+ Agregar" en vez
    // de dejar ese espacio vacío (el título/marca/precio no llenan el ancho
    // de la card, y las filas de color sí lo ocupan entero más abajo).
    var infoHtml = '<div class="name">' + p.DESCRIPCION + "</div>";
    if (p.MARCA) infoHtml += '<div class="brand">' + p.MARCA + "</div>";
    // Sin stock/vendido: solo círculos decorativos (no hay nada para elegir).
    // Con stock: los colores se eligen con cantidad más abajo.
    if (hasColores && sold) {
        infoHtml += '<div class="color-dots"><span class="color-lbl">Color</span>';
        p.COLORES.forEach(function (c) {
            infoHtml +=
                '<span class="color-dot" style="background:' +
                c.hex +
                '" title="' +
                c.nombre +
                '"></span>';
        });
        infoHtml += "</div>";
    }
    infoHtml +=
        '<div class="prices"><div class="price">' +
        fmt(p.PRECIO_MAYORISTA) +
        ' <span class="iva">+ IVA</span></div></div>';
    if (!sold && !waitlist && p.PREVENTA_MOSTRAR_STOCK) {
        infoHtml +=
            '<div class="stock-hint' +
            (p.STOCK_PREVENTA <= 2 ? " low" : "") +
            '">' +
            (p.STOCK_PREVENTA === 1
                ? "Queda 1 disponible"
                : "Quedan " + p.STOCK_PREVENTA + " disponibles") +
            "</div>";
    }

    var addBtnHtml;
    if (hasColores) {
        // En mobile abre el modal global (la card ocupa toda la fila, no
        // hay margen para un panel superpuesto legible); en desktop abre
        // el panel que "sube" tapando esta misma card, sin agrandarla —
        // ver .color-panel en catalogo.css y colorPanelHTML más abajo.
        var isMobileGrid = window.matchMedia("(max-width: 640px)").matches;
        addBtnHtml =
            '<button class="add' +
            (inCart ? " on" : "") +
            '" id="ab_' +
            id +
            '" onclick="' +
            (isMobileGrid ? "openColorModal('" : "openColorPanel('") +
            p.CODIGO +
            "')\">" +
            (inCart
                ? icon("check") + ' En pedido <span style="font-weight:600;opacity:.85">· ' + cart[p.CODIGO].qty + " u.</span>"
                : icon("palette") + " Elegir colores") +
            "</button>";
    } else {
        addBtnHtml =
            '<button class="add' +
            (inCart ? " on" : "") +
            '" id="ab_' +
            id +
            '" onclick="' +
            (inCart
                ? "toggleRemove('" + p.CODIGO + "')"
                : "addOrUpdate('" + p.CODIGO + "')") +
            '"' +
            (inCart
                ? ' style="font-size:10px;line-height:1.2;padding:5px 6px"'
                : "") +
            ">" +
            (inCart
                ? icon("check") + ' En pedido<br><span style="font-size:9px;opacity:.85">Quitar?</span>'
                : "+ Agregar") +
            "</button>";
    }

    // El panel de colores (desktop) va como hermano de .card-body, no
    // adentro — así al abrirse puede taparlo todo (incluida la imagen) y
    // tiene lugar de sobra para varias filas sin scroll, en vez de quedar
    // limitado al alto corto de .card-body. Ver cardPanelHtml más abajo.
    var cardPanelHtml = hasColores && !sold && !isMobileGrid ? colorPanelHTML(p) : "";

    if (hasColores && !sold) {
        html += infoHtml;
        html += '<div class="foot">' + addBtnHtml + "</div>";
    } else {
        html += infoHtml;
        if (sold) {
            html += '<div class="na">No disponible por ahora</div>';
        } else {
            html += '<div class="foot"><div class="qty">';
            html +=
                '<button class="qb" onclick="chgQty(\'' +
                p.CODIGO +
                "',-1)\">−</button>";
            html +=
                '<input class="qn" type="number" id="qn_' +
                id +
                '" value="' +
                qty +
                '" min="' +
                multiplo +
                '"' +
                (cap !== Infinity ? ' max="' + cap + '"' : "") +
                ' step="' +
                multiplo +
                '" onchange="manualQty(\'' +
                p.CODIGO +
                "',this.value)\" onblur=\"manualQty('" +
                p.CODIGO +
                "',this.value)\">";
            html +=
                '<button class="qb" onclick="chgQty(\'' +
                p.CODIGO +
                "',1)\">+</button></div>" +
                addBtnHtml +
                "</div>";
            if (multiplo > 1)
                html +=
                    '<div class="multiplo-hint">Múltiplo de ' + multiplo + "</div>";
        }
    }
    html += "</div>" + cardPanelHtml + "</div>";
    return html;
}

function renderList(list, el, sortBar) {
    var useGroups = activeCat === "TODOS" && sortMode === "default";
    var html = sortBar + '<div class="list-wrap"><table class="list-table">';
    html +=
        "<thead><tr><th>Img</th><th>Código</th><th>Descripción</th><th>Precio May.</th><th>Cantidad</th><th></th></tr></thead><tbody>";
    if (useGroups) {
        var bycat = {},
            order = [];
        list.forEach(function (p) {
            if (!bycat[p.CATEGORIA]) {
                bycat[p.CATEGORIA] = [];
                order.push(p.CATEGORIA);
            }
            bycat[p.CATEGORIA].push(p);
        });
        order.forEach(function (cat) {
            html +=
                '<tr><td colspan="7" style="background:var(--pale);font-weight:800;color:var(--blue);font-size:12px;padding:8px 14px;text-transform:uppercase;letter-spacing:.5px">' +
                cat +
                "</td></tr>";
            bycat[cat].forEach(function (p) {
                html += listRowHTML(p);
            });
        });
    } else {
        list.forEach(function (p) {
            html += listRowHTML(p);
        });
    }
    html += "</tbody></table></div>";
    el.innerHTML = html;
    setTimeout(activateLazy, 30);
}

function listCardHTML(p) {
    var sold = (p.ESTADO || "").toUpperCase() === "AGOTADO";
    var waitlist = !sold && isWaitlist(p.CODIGO);
    var inCart = !!cart[p.CODIGO];
    var qty = getQty(p.CODIGO);
    var multiplo = p.MULTIPLO || 1;
    var cap = getStockCap(p.CODIGO);
    var id = sid(p.CODIGO);
    var src = getImgSrc(p);
    var html =
        '<div class="lc' +
        (sold ? " sold-row" : "") +
        (inCart ? " picked-row" : "") +
        '" id="lr_' +
        id +
        '">';
    html += '<div class="lc-top">';
    html +=
        '<img class="lc-img" data-src="' +
        src +
        '" alt="" onerror="this.style.display=\'none\'">';
    html +=
        '<div class="lc-info"><div class="lc-name">' +
        p.DESCRIPCION +
        '</div><div class="lc-code">' +
        p.CODIGO +
        (sold ? ' <span class="badge">AGOTADO</span>' : "") +
        (activePreventa === "TODAS" && p.PREVENTA_NOMBRE
            ? '<div class="badge-preventa" style="margin-top:4px">' + p.PREVENTA_NOMBRE + "</div>"
            : "") +
        "</div></div>";
    html += "</div>";
    html +=
        '<div class="lc-price">' +
        fmt(p.PRECIO_MAYORISTA) +
        ' <span class="iva">+ IVA</span></div>';
    if (!sold && !waitlist && p.PREVENTA_MOSTRAR_STOCK) {
        html +=
            '<div class="stock-hint' +
            (p.STOCK_PREVENTA <= 2 ? " low" : "") +
            '">' +
            (p.STOCK_PREVENTA === 1
                ? "Queda 1"
                : "Quedan " + p.STOCK_PREVENTA) +
            "</div>";
    }
    var hasColores = p.COLORES && p.COLORES.length > 0;
    if (sold) {
        html += '<div style="color:#aaa;font-size:11px">No disponible</div>';
    } else if (hasColores) {
        html += '<div class="lc-foot lc-foot-colores">';
        html += colorQtyRowsHTML(p);
        html +=
            '<button class="list-add' +
            (inCart ? " on" : "") +
            '" id="ab_' +
            id +
            '" onclick="' +
            (inCart ? "toggleRemove('" + p.CODIGO + "')" : "addOrUpdateColores('" + p.CODIGO + "')") +
            '">' +
            (inCart ? icon("check") + " En pedido" : "+ Agregar") +
            "</button>";
        html += "</div>";
    } else {
        html += '<div class="lc-foot">';
        html +=
            '<div class="list-qty"><button class="qb" onclick="chgQty(\'' +
            p.CODIGO +
            '\',-1)">−</button><input class="qn" type="number" id="qn_' +
            id +
            '" value="' +
            qty +
            '" min="' +
            multiplo +
            '"' +
            (cap !== Infinity ? ' max="' + cap + '"' : "") +
            ' step="' +
            multiplo +
            '" onchange="manualQty(\'' +
            p.CODIGO +
            "',this.value)\" onblur=\"manualQty('" +
            p.CODIGO +
            '\',this.value)" style="width:36px"><button class="qb" onclick="chgQty(\'' +
            p.CODIGO +
            "',1)\">+</button></div>";
        html +=
            '<button class="list-add' +
            (inCart ? " on" : "") +
            '" id="ab_' +
            id +
            '" onclick="addOrUpdate(\'' +
            p.CODIGO +
            "')\">" +
            (inCart ? icon("check") : "+ Agregar") +
            "</button>";
        html += "</div>";
    }
    html += "</div>";
    return html;
}

function listRowHTML(p) {
    var sold = (p.ESTADO || "").toUpperCase() === "AGOTADO";
    var waitlist = !sold && isWaitlist(p.CODIGO);
    var inCart = !!cart[p.CODIGO];
    var qty = getQty(p.CODIGO);
    var multiplo = p.MULTIPLO || 1;
    var cap = getStockCap(p.CODIGO);
    var id = sid(p.CODIGO);
    var src = getImgSrc(p);
    var html =
        '<tr class="' +
        (sold ? "sold-row" : "") +
        (inCart ? " picked-row" : "") +
        '" id="lr_' +
        id +
        '">';
    html +=
        '<td><img class="list-thumb" data-src="' +
        src +
        '" alt="" onclick="openLightbox(this)" onerror="this.style.display=\'none\'"></td>';
    html +=
        '<td><span class="code">' +
        p.CODIGO +
        "</span>" +
        (sold ? ' <span class="badge">AGOTADO</span>' : "") +
        "</td>";
    html +=
        '<td style="font-weight:600">' +
        p.DESCRIPCION +
        (multiplo > 1
            ? ' <small style="color:var(--muted)">(x' + multiplo + ")</small>"
            : "") +
        (p.MARCA ? '<div style="font-weight:400;font-size:11px;color:var(--muted)">' + p.MARCA + "</div>" : "") +
        "</td>";
    html +=
        '<td style="font-weight:800;color:var(--blue)">' +
        fmt(p.PRECIO_MAYORISTA) +
        ' <span class="iva">+ IVA</span></td>';
    var hasColores = p.COLORES && p.COLORES.length > 0;
    if (sold) {
        html +=
            '<td colspan="2"><span style="color:#aaa;font-size:12px">No disponible</span></td>';
    } else if (hasColores) {
        html +=
            '<td>' +
            (!waitlist && p.PREVENTA_MOSTRAR_STOCK
                ? '<div class="stock-hint' +
                    (p.STOCK_PREVENTA <= 2 ? " low" : "") +
                    '">' +
                    (p.STOCK_PREVENTA === 1
                        ? "Queda 1"
                        : "Quedan " + p.STOCK_PREVENTA) +
                    "</div>"
                  : "") +
            colorQtyRowsHTML(p) +
            "</td>";
        html +=
            '<td><button class="list-add' +
            (inCart ? " on" : "") +
            '" id="ab_' +
            id +
            '" onclick="addOrUpdateColores(\'' +
            p.CODIGO +
            "')\">" +
            (inCart ? icon("check") + " En pedido" : "+ Agregar") +
            "</button></td>";
    } else {
        html +=
            '<td>' +
            (!waitlist && p.PREVENTA_MOSTRAR_STOCK
                ? '<div class="stock-hint' +
                    (p.STOCK_PREVENTA <= 2 ? " low" : "") +
                    '">' +
                    (p.STOCK_PREVENTA === 1
                        ? "Queda 1"
                        : "Quedan " + p.STOCK_PREVENTA) +
                    "</div>"
                  : "") +
            '<div class="list-qty"><button class="qb" onclick="chgQty(\'' +
            p.CODIGO +
            '\',-1)">−</button><input class="qn" type="number" id="qn_' +
            id +
            '" value="' +
            qty +
            '" min="' +
            multiplo +
            '"' +
            (cap !== Infinity ? ' max="' + cap + '"' : "") +
            ' step="' +
            multiplo +
            '" onchange="manualQty(\'' +
            p.CODIGO +
            "',this.value)\" onblur=\"manualQty('" +
            p.CODIGO +
            '\',this.value)" style="width:40px"><button class="qb" onclick="chgQty(\'' +
            p.CODIGO +
            "',1)\">+</button></div></td>";
        html +=
            '<td><button class="list-add' +
            (inCart ? " on" : "") +
            '" id="ab_' +
            id +
            '" onclick="addOrUpdate(\'' +
            p.CODIGO +
            "')\">" +
            (inCart ? icon("check") + " En pedido" : "+ Agregar") +
            "</button></td>";
    }
    html += "</tr>";
    return html;
}

function toggleRemove(code) {
    var id = sid(code);
    var btn = document.getElementById("ab_" + id);
    if (!btn) return;
    // Primer clic: mostrar "¿Quitar?"
    if (btn.dataset.confirm !== "1") {
        btn.dataset.confirm = "1";
        btn.innerHTML = "¿Confirmar quitar?";
        btn.style.fontSize = "10px";
        btn.style.background = "#c62828";
        btn.style.borderColor = "#c62828";
        setTimeout(function () {
            if (btn.dataset.confirm === "1") {
                btn.dataset.confirm = "0";
                btn.innerHTML =
                    icon("check") + ' En pedido<br><span style="font-size:9px;opacity:.85">Quitar?</span>';
                btn.style.background = "";
                btn.style.borderColor = "";
            }
        }, 3000);
        return;
    }
    btn.dataset.confirm = "0";
    rmCart(code);
    btn.innerHTML = "Se quitó " + icon("check");
    btn.style.fontSize = "11px";
    btn.style.background = "#555";
    btn.style.borderColor = "#555";
    btn.classList.remove("on");
    setTimeout(function () {
        btn.innerHTML = "+ Agregar";
        btn.style.fontSize = "";
        btn.style.lineHeight = "";
        btn.style.padding = "";
        btn.style.background = "";
        btn.style.borderColor = "";
        var p = products.find(function (x) { return x.CODIGO === code; });
        var hasColores = p && p.COLORES && p.COLORES.length > 0;
        btn.onclick = function () {
            if (hasColores) addOrUpdateColores(code);
            else addOrUpdate(code);
        };
    }, 1500);
}

function manualQty(code, val) {
    var multiplo = getMultiplo(code);
    var num = parseInt(val) || multiplo;
    var snapped = snapToMultiplo(num, multiplo, code);
    var id = sid(code);
    var el = document.getElementById("qn_" + id);
    if (el) el.value = snapped;
    if (cart[code]) {
        cart[code].qty = snapped;
        updateCart();
    }
}

function chgQty(code, delta) {
    var multiplo = getMultiplo(code);
    var id = sid(code);
    var el = document.getElementById("qn_" + id);
    if (!el) return;
    var cur = parseInt(el.value) || multiplo;
    var next = snapToMultiplo(cur + delta * multiplo, multiplo, code);
    el.value = next;
    if (cart[code]) {
        cart[code].qty = next;
        updateCart();
    }
}

function addOrUpdate(code) {
    var p = products.find(function (x) {
        return x.CODIGO === code;
    });
    if (!p) return;
    var multiplo = p.MULTIPLO || 1;
    var id = sid(code);
    var qEl = document.getElementById("qn_" + id);
    var qty = qEl
        ? snapToMultiplo(parseInt(qEl.value) || multiplo, multiplo, code)
        : multiplo;
    if (qEl) qEl.value = qty;
    cart[code] = { p: p, qty: qty };
    var card = document.getElementById(id);
    if (card) {
        card.classList.add("picked");
        var btn = document.getElementById("ab_" + id);
        if (btn) {
            btn.innerHTML =
                icon("check") + ' En pedido<br><span style="font-size:9px;opacity:.85">Quitar?</span>';
            btn.style.fontSize = "10px";
            btn.style.lineHeight = "1.2";
            btn.style.padding = "5px 6px";
            btn.classList.add("on");
            btn.onclick = function () {
                toggleRemove(code);
            };
        }
    }
    var row = document.getElementById("lr_" + id);
    if (row) {
        row.classList.add("picked-row");
        var lbtn = document.getElementById("ab_" + id);
        if (lbtn) {
            lbtn.innerHTML = icon("check") + " En pedido";
            lbtn.classList.add("on");
            lbtn.classList.remove("pending");
        }
    }
    saveCart();
    updateCart();
}

function rmCart(code) {
    var multiplo = getMultiplo(code);
    delete cart[code];
    var id = sid(code);
    var qEl = document.getElementById("qn_" + id);
    if (qEl) qEl.value = multiplo;
    var p = products.find(function (x) { return x.CODIGO === code; });
    if (p && p.COLORES) {
        p.COLORES.forEach(function (c, idx) {
            var cEl = document.getElementById("cq_" + id + "_" + idx);
            if (cEl) cEl.value = 0;
        });
    }
    var card = document.getElementById(id);
    if (card) {
        card.classList.remove("picked");
        var btn = document.getElementById("ab_" + id);
        if (btn) {
            btn.textContent = "+ Agregar";
            btn.classList.remove("on");
        }
    }
    var row = document.getElementById("lr_" + id);
    if (row) {
        row.classList.remove("picked-row");
        var lbtn = document.getElementById("ab_" + id);
        if (lbtn) {
            lbtn.textContent = "+ Agregar";
            lbtn.classList.remove("on");
        }
    }
    saveCart();
    updateCart();
}

function setCartQty(code, qty) {
    var multiplo = getMultiplo(code);
    var snapped = snapToMultiplo(qty, multiplo, code);
    if (snapped < multiplo) {
        rmCart(code);
        return;
    }
    if (cart[code]) {
        cart[code].qty = snapped;
        var id = sid(code);
        var qEl = document.getElementById("qn_" + id);
        if (qEl) qEl.value = snapped;
        saveCart();
        updateCart();
    }
}

function updateCart() {
    var keys = Object.keys(cart);
    document.getElementById("cartN").textContent = keys.length;
    var el = document.getElementById("pitems");
    if (!keys.length) {
        el.innerHTML =
            '<div class="empty">Todavía no agregaste productos.</div>';
        document.getElementById("ptotal").textContent = "$ 0";
        return;
    }
    var total = 0,
        html = "";
    keys.forEach(function (code) {
        var item = cart[code];
        var multiplo = item.p.MULTIPLO || 1;
        var sub = Math.round(
            (parseFloat(item.p.PRECIO_MAYORISTA) || 0) * item.qty,
        );
        total += sub;
        var imgSrc = getImgSrc(item.p);
        html += '<div class="ci">';
        html +=
            '<img class="ci-img" src="' +
            imgSrc +
            '" alt="" onerror="this.style.display=\'none\'">';
        html += '<div class="ci-body">';
        html += '<div class="ci-name">' + item.p.DESCRIPCION + "</div>";
        html +=
            '<div class="ci-code">Cód: ' +
            item.p.CODIGO +
            (multiplo > 1 ? " · x" + multiplo : "") +
            "</div>";
        html += '<div class="ci-row"><div class="cq">';
        html +=
            '<button class="cqb" onclick="setCartQty(\'' +
            code +
            "'," +
            (item.qty - multiplo) +
            ')">−</button>';
        html += '<span class="cqn">' + item.qty + "</span>";
        html +=
            '<button class="cqb" onclick="setCartQty(\'' +
            code +
            "'," +
            (item.qty + multiplo) +
            ')">+</button>';
        html +=
            '</div><span class="ci-sub">' +
            fmt(sub) +
            '</span><button class="rm" onclick="rmCart(\'' +
            code +
            "')\">" + icon("trash-2") + "</button></div>";
        html += "</div></div>";
    });
    el.innerHTML = html;
    document.getElementById("ptotal").textContent = fmt(total) + " + IVA";
}

function openCart() {
    document.getElementById("overlay").classList.add("open");
    // En mobile, mostrar productos por defecto al abrir
    if (window.innerWidth <= 640) {
        var sec = document.getElementById("cartItemsSection");
        if (sec) sec.classList.remove("mobile-collapsed");
        var lbl = document.getElementById("toggleItemsLabel");
        if (lbl) lbl.innerHTML = icon("chevron-up", {size: 14}) + " Ocultar productos";
    }
}
function closeCart() {
    document.getElementById("overlay").classList.remove("open");
}
function bgClose(e) {
    if (e.target === document.getElementById("overlay")) closeCart();
}

function toggleCartSection(which) {
    if (which === "items") {
        var sec = document.getElementById("cartItemsSection");
        var lbl = document.getElementById("toggleItemsLabel");
        var collapsed = sec.classList.toggle("mobile-collapsed");
        lbl.innerHTML = collapsed
            ? icon("chevron-down", {size: 14}) + " Ver productos del pedido"
            : icon("chevron-up", {size: 14}) + " Ocultar productos";
    } else {
        var sec = document.getElementById("cartFormSection");
        var lbl = document.getElementById("toggleFormLabel");
        var collapsed = sec.classList.toggle("collapsed");
        lbl.innerHTML = collapsed
            ? icon("chevron-down", {size: 14}) + " Datos del pedido"
            : icon("chevron-up", {size: 14}) + " Ocultar datos";
    }
}

// ── CLIENTE ───────────────────────────────────────────────────────────────────
var clienteId = null;
var transportes = [];

fetch(API_URL + "?action=transportes")
    .then(function (r) {
        return r.json();
    })
    .then(function (data) {
        transportes = data;
    })
    .catch(function () {});

function normalizarTelJS(caract, num) {
    var c = caract.replace(/\D/g, "").replace(/^0/, "");
    var n = num.replace(/\D/g, "").replace(/^15/, "");
    return "54" + c + n;
}

function telCompleto() {
    var c = document.getElementById("cCaract").value.trim();
    var n = document.getElementById("cNum").value.trim();
    return c.length >= 2 && n.length >= 6;
}

var telTimeout = null;
function onTelChange() {
    clienteId = null;
    document.getElementById("clienteForm").style.display = "none";
    clearTimeout(telTimeout);
    if (!telCompleto()) return;
    telTimeout = setTimeout(buscarCliente, 600);
}

async function buscarCliente() {
    var caract = document.getElementById("cCaract").value.trim();
    var num = document.getElementById("cNum").value.trim();
    var tel = normalizarTelJS(caract, num);
    try {
        var res = await fetch(
            API_URL +
                "?action=cliente_buscar&telefono=" +
                encodeURIComponent(tel),
        );
        var json = await res.json();
        if (json.found) {
            mostrarFormCliente(json.cliente);
            toastCarrito(
                "👋 ¡Bienvenido, " +
                    json.cliente.nombre.split(" ")[0] +
                    "! Tus datos fueron cargados automáticamente.",
                "#2e7d32",
            );
        } else {
            mostrarFormCliente(null);
            toastCarrito(
                "📝 Primera vez por acá. Completá tus datos para confirmar el pedido.",
                "#e84e1b",
            );
        }
    } catch (e) {
        mostrarFormCliente(null);
    }
}

function toastCarrito(msg, color) {
    var t = document.getElementById("cartToast");
    if (!t) return;
    t.textContent = msg;
    t.style.background = color || "#333";
    t.classList.add("show");
    setTimeout(function () {
        t.classList.remove("show");
    }, 4000);
}

function mostrarFormCliente(cliente) {
    var form = document.getElementById("clienteForm");
    form.style.display = "block";
    clienteId = cliente ? cliente.id : null;
    document.getElementById("cNombre").value = cliente
        ? cliente.nombre || ""
        : "";
    document.getElementById("cCuitDni").value = cliente
        ? cliente.cuit_dni || ""
        : "";
    document.getElementById("cEmail").value = cliente
        ? cliente.email || ""
        : "";
    document.getElementById("cDomicilio").value = cliente
        ? cliente.domicilio || ""
        : "";
    document.getElementById("cLocalidad").value = cliente
        ? cliente.localidad || ""
        : "";
    document.getElementById("cCP").value = cliente ? cliente.cp || "" : "";
    document.getElementById("cProvincia").value = cliente
        ? cliente.provincia || ""
        : "";
    document.getElementById("cNotas").value = cliente
        ? cliente.notas || ""
        : "";
    // Transporte
    var sel = document.getElementById("cTransporte");
    sel.innerHTML = '<option value="">— Seleccioná —</option>';
    transportes.forEach(function (t) {
        sel.innerHTML +=
            '<option value="' +
            t.nombre +
            '"' +
            (cliente && cliente.transporte === t.nombre ? " selected" : "") +
            ">" +
            t.nombre +
            "</option>";
    });
    sel.innerHTML +=
        '<option value="OTRO"' +
        (cliente && cliente.transporte === "OTRO" ? " selected" : "") +
        ">Otro</option>";
    onTransporteChange();
    if (cliente && cliente.transporte === "OTRO")
        document.getElementById("cTransporteOtro").value =
            cliente.transporte_otro || "";
}

function onTransporteChange() {
    var sel = document.getElementById("cTransporte").value;
    document.getElementById("cTransporteOtroWrap").style.display =
        sel === "OTRO" ? "block" : "none";
}

async function sendWA() {
    var keys = Object.keys(cart);
    if (!keys.length) {
        alert("Agregá al menos un producto.");
        return;
    }
    var nombre = document.getElementById("cNombre").value.trim();
    var caract = document.getElementById("cCaract").value.trim();
    var num = document.getElementById("cNum").value.trim();
    if (!telCompleto()) {
        // Si el formulario no está visible, mostrarlo para que el cliente sepa qué falta
        if (document.getElementById("clienteForm").style.display === "none") {
            toastCarrito(
                "📞 Completá el número de teléfono para continuar.",
                "#c62828",
            );
        } else {
            alert(
                "El teléfono está incompleto. Ingresá la característica y el número.",
            );
        }
        document.getElementById("cCaract").focus();
        return;
    }
    if (!nombre) {
        alert("El nombre es obligatorio.");
        document.getElementById("cNombre").focus();
        return;
    }
    var tel = normalizarTelJS(caract, num);
    var transporte = document.getElementById("cTransporte").value;
    if (transporte === "OTRO")
        transporte =
            document.getElementById("cTransporteOtro").value.trim() || "OTRO";
    var clienteData = {
        telefono: tel,
        nombre: nombre.toUpperCase(),
        cuit_dni: document
            .getElementById("cCuitDni")
            .value.trim()
            .toUpperCase(),
        email: document.getElementById("cEmail").value.trim().toLowerCase(),
        domicilio: document
            .getElementById("cDomicilio")
            .value.trim()
            .toUpperCase(),
        localidad: document
            .getElementById("cLocalidad")
            .value.trim()
            .toUpperCase(),
        cp: document.getElementById("cCP").value.trim(),
        provincia: document
            .getElementById("cProvincia")
            .value.trim()
            .toUpperCase(),
        transporte,
    };
    var notasPedido = document
        .getElementById("cNotas")
        .value.trim()
        .toUpperCase();
    var btn = document.querySelector(".wa");
    btn.disabled = true;
    btn.style.background = "#1a9e52";
    btn.innerHTML =
        '<span style="display:inline-block;animation:spin .6s linear infinite;margin-right:8px">' + icon("loader-circle") + '</span> Verificando stock...';

    // Verificar stock actualizado
    try {
        var resProds = await fetch(
            API_URL + "?action=productos&t=" + Date.now(),
        );
        var freshProds = await resProds.json();
        var agotados = [];
        Object.keys(cart).forEach(function (code) {
            var fresh = freshProds.find(function (p) {
                return p.codigo === code;
            });
            if (fresh && (fresh.estado || "").toUpperCase() === "AGOTADO") {
                agotados.push(
                    "• " + cart[code].p.DESCRIPCION + " (Cód: " + code + ")",
                );
                // Actualizar card visualmente
                var id = sid(code);
                var card = document.getElementById(id);
                if (card) {
                    card.classList.remove("picked");
                    card.classList.add("sold");
                    var foot = card.querySelector(".foot");
                    if (foot)
                        foot.innerHTML =
                            '<div class="na">No disponible por ahora</div>';
                    var ctop = card.querySelector(".c-top");
                    if (ctop && !ctop.querySelector(".badge"))
                        ctop.innerHTML += '<span class="badge">AGOTADO</span>';
                }
                delete cart[code];
            }
        });
        if (agotados.length > 0) {
            saveCart();
            updateCart();
            btn.disabled = false;
            btn.style.background = "";
            btn.innerHTML = icon("send") + " Confirmar y enviar pedido";
            alert(
                "⚠️ Los siguientes artículos se agotaron y fueron quitados de tu pedido:\n\n" +
                    agotados.join("\n") +
                    "\n\nPodés agregar otros artículos o continuar con el pedido actual.",
            );
            return;
        }
    } catch (e) {}

    btn.innerHTML =
        '<span style="display:inline-block;animation:spin .6s linear infinite;margin-right:8px">' + icon("loader-circle") + '</span> Procesando...';
    // Guardar cliente en BD
    var cRes = await fetch(API_URL + "?action=cliente_guardar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clienteData),
    });
    var cJson = await cRes.json();
    if (!cJson.ok) {
        alert("Error al guardar datos del cliente");
        btn.disabled = false;
        btn.style.background = "";
        btn.innerHTML = icon("send") + " Confirmar y enviar pedido";
        return;
    }
    clienteId = cJson.id;
    // Armar items (el servidor recalcula stock/lista de espera de forma
    // atómica al crear el pedido — acá solo mandamos lo que el cliente eligió)
    var itemsEnviar = [];
    Object.keys(cart).forEach(function (code) {
        var item = cart[code];
        var precio = parseFloat(item.p.PRECIO_MAYORISTA) || 0;
        var sub = Math.round(precio * item.qty);
        itemsEnviar.push({
            codigo: item.p.CODIGO,
            descripcion: item.p.DESCRIPCION,
            cantidad: item.qty,
            precio_unitario: precio,
            subtotal: sub,
            colores: item.colores || null,
        });
    });
    // Guardar pedido en BD — la respuesta trae el total real y qué ítems
    // quedaron en lista de espera por stock insuficiente al confirmar
    var pedidoRes = await fetch(API_URL + "?action=pedido_crear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            cliente_id: clienteId,
            items: itemsEnviar,
            observaciones: notasPedido,
        }),
    });
    var pedidoJson = await pedidoRes.json();
    if (!pedidoJson.ok) {
        alert("Error al crear el pedido: " + (pedidoJson.error || ""));
        btn.disabled = false;
        btn.style.background = "";
        btn.innerHTML = icon("send") + " Confirmar y enviar pedido";
        return;
    }
    var itemsFinal = pedidoJson.items || itemsEnviar;
    var total = pedidoJson.total || 0;
    // Armar mensaje WhatsApp
    var fecha = new Date().toLocaleDateString("es-AR");
    var msg = "🛍️ *PEDIDO PREVENTA — CINDY MAYORISTA*\n━━━━━━━━━━━━━━━━━━━━━━\n";
    msg += "👤 *Cliente:* " + nombre + "\n";
    msg += "📞 *Tel:* +" + tel + "\n";
    if (clienteData.cuit_dni)
        msg += "🪪 *CUIT/DNI:* " + clienteData.cuit_dni + "\n";
    if (clienteData.domicilio)
        msg +=
            "📍 *Envío:* " +
            clienteData.domicilio +
            ", " +
            (clienteData.localidad || "") +
            " (" +
            (clienteData.cp || "") +
            ") " +
            (clienteData.provincia || "") +
            "\n";
    if (transporte) msg += "🚚 *Transporte:* " + transporte + "\n";
    if (clienteData.notas) msg += "📝 *Notas:* " + clienteData.notas + "\n";
    msg += "📅 *Fecha:* " + fecha + "\n━━━━━━━━━━━━━━━━━━━━━━\n\n";
    var hayListaEspera = false;
    // Agrupar por preventa (snapshot tomado por el backend al crear el
    // pedido) para que quede claro de qué campaña es cada ítem, sobre todo
    // cuando el pedido mezcla artículos de más de una preventa.
    var gruposWA = {}, ordenWA = [];
    itemsFinal.forEach(function (item) {
        var g = item.preventa_nombre || "Catálogo general";
        if (!gruposWA[g]) { gruposWA[g] = []; ordenWA.push(g); }
        gruposWA[g].push(item);
    });
    ordenWA.forEach(function (nombreGrupo) {
        msg += "🏷️ *" + nombreGrupo + "*\n";
        gruposWA[nombreGrupo].forEach(function (item) {
            var esperaTag = item.en_lista_espera == 1 ? " ⏳ *A CONFIRMAR STOCK*" : "";
            if (item.en_lista_espera == 1) hayListaEspera = true;
            var coloresTxt = "";
            if (item.colores_detalle) {
                try {
                    var cobj = JSON.parse(item.colores_detalle);
                    coloresTxt = "\n  " + Object.keys(cobj).map(function (k) { return k + ": " + cobj[k]; }).join(" · ");
                } catch (e) {}
            }
            msg +=
                "• *" +
                item.descripcion +
                "*\n  Cód: " +
                item.codigo +
                "  |  Cant: " +
                item.cantidad +
                "  |  " +
                fmt(item.subtotal) +
                " + IVA" +
                esperaTag +
                coloresTxt +
                "\n\n";
        });
    });
    msg +=
        "━━━━━━━━━━━━━━━━━━━━━━\n*TOTAL: " +
        fmt(total) +
        " + IVA*\n";
    if (hayListaEspera)
        msg +=
            "\n⏳ Los ítems marcados \"A CONFIRMAR STOCK\" superan el stock de preventa cargado — quedan en lista de espera hasta confirmar disponibilidad.\n";
    msg +=
        "━━━━━━━━━━━━━━━━━━━━━━\n_Pedido generado desde el catálogo de preventa de Cindy Mayorista_";
    window.open(
        "https://wa.me/" + WA_NUM + "?text=" + encodeURIComponent(msg),
        "_blank",
    );
    // Botón queda en estado enviado
    btn.style.background = "#2e7d32";
    btn.innerHTML = icon("circle-check-big") + " Pedido enviado";
    btn.disabled = true;
    // Limpiar carrito y resetear cards
    cart = {};
    saveCart();
    updateCart();
    // Resetear todas las cards visualmente
    document.querySelectorAll(".card.picked").forEach(function (card) {
        card.classList.remove("picked");
        var ab = card.querySelector(".add");
        if (ab) {
            ab.textContent = "+ Agregar";
            ab.classList.remove("on");
            ab.style.fontSize = "";
            ab.style.lineHeight = "";
            ab.style.padding = "";
            ab.style.background = "";
            ab.style.borderColor = "";
            var code = card.id.replace(/^p/, "").replace(/_/g, "/");
            ab.onclick = function () {
                addOrUpdate(code);
            };
        }
    });
    // Resetear filas de lista
    document
        .querySelectorAll(".list-table tr.picked-row")
        .forEach(function (row) {
            row.classList.remove("picked-row");
            var ab = row.querySelector(".list-add");
            if (ab) {
                ab.textContent = "+ Agregar";
                ab.classList.remove("on");
            }
        });
    // Rehabilitar botón después de 3 segundos para nuevos pedidos
    setTimeout(function () {
        btn.disabled = false;
        btn.style.background = "";
        btn.innerHTML = icon("send") + " Confirmar y enviar pedido";
    }, 3000);
}

start();

// ── NOTA DE PEDIDO IMPRIMIBLE ─────────────────────────────────────────────────

function printNota() {
    var disponibles = products.filter(function (p) { return p.ESTADO === "DISPONIBLE"; });
    if (!disponibles.length) { alert("No hay productos disponibles para imprimir."); return; }

    // Agrupar por categoría, respetando orden de categoría
    var cats = {};
    disponibles.forEach(function (p) {
        var c = p.CATEGORIA || "SIN CATEGORÍA";
        if (!cats[c]) cats[c] = { orden: p.CAT_ORDEN || 0, prods: [] };
        cats[c].prods.push(p);
    });
    var catsSorted = Object.keys(cats).sort(function (a, b) { return cats[a].orden - cats[b].orden || a.localeCompare(b); });

    var fecha = new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });

    var html = '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">' +
        '<title>Nota de Pedido Preventa Cindy Mayorista — ' + fecha + '</title>' +
        '<style>' +
        'body{font-family:Arial,sans-serif;font-size:11px;color:#000;margin:0;padding:0}' +
        '.page{padding:14mm 12mm;max-width:210mm;margin:0 auto}' +
        '.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px}' +
        '.header h1{font-size:16px;font-weight:900;letter-spacing:.5px;color:#003399;margin:0}' +
        '.header .fecha{font-size:11px;color:#555;text-align:right}' +
        '.cliente-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;border:1px solid #888;padding:8px 10px;margin-bottom:10px}' +
        '.cliente-grid .campo{display:flex;gap:6px;align-items:baseline;border-bottom:1px dotted #ccc;padding:2px 0}' +
        '.cliente-grid .campo label{font-size:9px;font-weight:700;text-transform:uppercase;color:#555;white-space:nowrap;min-width:70px}' +
        '.cliente-grid .campo span{flex:1;border-bottom:none;font-size:11px}' +
        '.cat-title{font-size:12px;font-weight:900;background:#003399;color:#fff;padding:3px 8px;margin:10px 0 0}' +
        'table{width:100%;border-collapse:collapse;margin-bottom:0}' +
        'thead tr{background:#dde6ff}' +
        'th,td{border:1px solid #ccc;padding:3px 5px;text-align:left;font-size:10px}' +
        'th{font-weight:700;font-size:9px;text-transform:uppercase;color:#003}' +
        'td.cant{text-align:center;width:36px}' +
        'td.precio{text-align:right}' +
        'tr:nth-child(even){background:#f8f9ff}' +
        '.footer{margin-top:14px;border-top:1px solid #bbb;padding-top:6px;font-size:9px;color:#777;text-align:center}' +
        '@media print{@page{size:A4 portrait;margin:10mm}body{font-size:10px}.page{padding:0;max-width:none}}' +
        '</style></head><body><div class="page">' +
        '<div class="header">' +
        '<div><h1>CINDY MAYORISTA</h1><div style="font-size:11px;font-weight:600;color:#555;margin-top:2px">NOTA DE PEDIDO — PREVENTA (precios + IVA)</div></div>' +
        '<div class="fecha">Fecha: ' + fecha + '<br><span style="font-size:9px;color:#999">Precios al momento de impresión</span></div>' +
        '</div>' +
        '<div class="cliente-grid">' +
        '<div class="campo"><label>Empresa / Nombre</label><span>&nbsp;</span></div>' +
        '<div class="campo"><label>CUIT / DNI</label><span>&nbsp;</span></div>' +
        '<div class="campo"><label>Dirección</label><span>&nbsp;</span></div>' +
        '<div class="campo"><label>Localidad</label><span>&nbsp;</span></div>' +
        '<div class="campo"><label>Provincia</label><span>&nbsp;</span></div>' +
        '<div class="campo"><label>CP</label><span>&nbsp;</span></div>' +
        '<div class="campo"><label>Teléfono</label><span>&nbsp;</span></div>' +
        '<div class="campo"><label>Email</label><span>&nbsp;</span></div>' +
        '<div class="campo"><label>Transporte</label><span>&nbsp;</span></div>' +
        '<div class="campo"><label>Observaciones</label><span>&nbsp;</span></div>' +
        '</div>';

    catsSorted.forEach(function (cat) {
        html += '<div class="cat-title">' + cat + '</div>' +
            '<table><thead><tr><th style="width:60px">Código</th><th>Descripción</th><th class="precio" style="width:90px">P. Mayorista</th><th class="cant">Cant.</th></tr></thead><tbody>';
        cats[cat].prods.forEach(function (p) {
            html += '<tr>' +
                '<td><code style="font-size:9px">' + p.CODIGO + '</code></td>' +
                '<td>' + p.DESCRIPCION + '</td>' +
                '<td class="precio">' + fmt(p.PRECIO_MAYORISTA) + '</td>' +
                '<td class="cant"></td>' +
                '</tr>';
        });
        html += '</tbody></table>';
    });

    html += '<div class="footer">Cindy Mayorista — Bags Store SRL — Catálogo de Preventa</div>' +
        '</div></body></html>';

    var win = window.open("", "_blank", "width=900,height=700");
    if (!win) { alert("Habilitá las ventanas emergentes para imprimir."); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(function () { win.print(); }, 400);
}

// ── Barcode scanner ──────────────────────────────────────────────
var barcodeScanner = null;
var SCAN_CONFIRM_NEEDED = 3;   // lecturas consecutivas iguales para confirmar

function showFocusIndicator(clientX, clientY) {
    var el = document.createElement("div");
    el.className = "focus-indicator";
    el.style.left = (clientX - 28) + "px";
    el.style.top  = (clientY - 28) + "px";
    document.body.appendChild(el);
    setTimeout(function() { el.remove(); }, 650);
}

function setupTapToFocus(readerEl) {
    readerEl.addEventListener("click", function(e) {
        var video = readerEl.querySelector("video");
        if (!video || !video.srcObject) return;
        var track = video.srcObject.getVideoTracks()[0];
        if (!track) return;

        showFocusIndicator(e.clientX, e.clientY);

        var cap = track.getCapabilities ? track.getCapabilities() : {};
        if (cap.pointsOfInterest) {
            var rect = video.getBoundingClientRect();
            var x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            var y = Math.max(0, Math.min(1, (e.clientY - rect.top)  / rect.height));
            track.applyConstraints({
                advanced: [{ focusMode: "manual", pointsOfInterest: [{ x: x, y: y }] }]
            }).catch(function() {
                track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(function(){});
            });
        }
        // En iOS el tap sobre el video ya dispara el foco nativo del OS;
        // el indicador visual igual aparece para dar feedback al usuario.
    });
}

function scannerBeep() {
    try {
        var ctx = new (window.AudioContext || window.webkitAudioContext)();
        var osc  = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 1800;
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.15);
    } catch(e) { /* navegador sin soporte, ignorar */ }
}

function openBarcodeScanner(callback) {
    var modal = document.getElementById("scannerModal");
    if (!modal) return;
    modal.classList.add("open");
    document.getElementById("scannerStatus").textContent = "Iniciando cámara…";
    barcodeScanner = new Html5Qrcode("scannerReader");

    var lastCode = null, confirmCount = 0;

    barcodeScanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 260, height: 120 } },
        function(decodedText) {
            var code = decodedText.trim();
            if (code === lastCode) {
                confirmCount++;
            } else {
                lastCode = code;
                confirmCount = 1;
            }
            var statusEl = document.getElementById("scannerStatus");
            if (confirmCount >= SCAN_CONFIRM_NEEDED) {
                scannerBeep();
                closeBarcodeScanner();
                if (typeof callback === "function") callback(code);
            } else {
                if (statusEl) statusEl.textContent =
                    "Verificando… " + confirmCount + "/" + SCAN_CONFIRM_NEEDED + " — mantené la cámara quieta";
            }
        },
        function() { /* frame errors ignored */ }
    ).then(function() {
        document.getElementById("scannerStatus").textContent = "Apuntá la cámara al código de barras";
        setupTapToFocus(document.getElementById("scannerReader"));
    }).catch(function(err) {
        document.getElementById("scannerStatus").textContent = "Error al iniciar cámara: " + err;
    });
}
function closeBarcodeScanner() {
    var modal = document.getElementById("scannerModal");
    if (modal) modal.classList.remove("open");
    if (barcodeScanner) {
        barcodeScanner.stop().catch(function() {});
        barcodeScanner = null;
        var r = document.getElementById("scannerReader");
        if (r) r.innerHTML = "";
    }
}
