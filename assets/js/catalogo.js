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
    if (!wrap) return;
    var preventas = getPreventas();
    if (!preventas.length) { wrap.innerHTML = ""; wrap.style.display = "none"; return; }
    wrap.style.display = "";
    var html = "";
    preventas.forEach(function (pv) {
        var bg = pv.imagen ? 'style="background-image:url(\'' + pv.imagen + '\')"' : "";
        html +=
            '<button class="prev-card' + (String(activePreventa) === String(pv.id) ? " on" : "") + (pv.imagen ? " has-img" : "") + '" ' + bg +
            ' onclick="setPreventa(\'' + pv.id + '\')">' +
            '<span class="prev-card-text"><span class="prev-card-name">' + pv.nombre + "</span>" +
            (pv.detalle ? '<span class="prev-card-detalle">' + pv.detalle + "</span>" : "") +
            "</span></button>";
    });
    html +=
        '<button class="prev-card prev-card-all' + (activePreventa === "TODAS" ? " on" : "") + '" onclick="setPreventa(\'TODAS\')">' +
        '<span class="prev-card-name">Todas las preventas</span></button>';
    wrap.innerHTML = html;
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
        '" onerror="this.style.display=\'none\'"></div>';
    html += '<div class="card-body">';
    html +=
        '<div class="c-top"><span class="code">' +
        p.CODIGO +
        "</span>" +
        (sold
            ? '<span class="badge">AGOTADO</span>'
            : waitlist
              ? '<span class="badge badge-wait">LISTA DE ESPERA</span>'
              : "") +
        "</div>";
    if (activePreventa === "TODAS" && p.PREVENTA_NOMBRE)
        html += '<div class="badge-preventa">' + p.PREVENTA_NOMBRE + "</div>";
    html += '<div class="name">' + p.DESCRIPCION + "</div>";
    if (p.MARCA) html += '<div class="brand">' + p.MARCA + "</div>";
    // Círculos de colores
    if (p.COLORES && p.COLORES.length > 0) {
        html += '<div class="color-dots"><span class="color-lbl">Color</span>';
        p.COLORES.forEach(function (c) {
            html +=
                '<span class="color-dot" style="background:' +
                c.hex +
                '" title="' +
                c.nombre +
                '"></span>';
        });
        html += "</div>";
    }
    html +=
        '<div class="prices"><div class="price">' +
        fmt(p.PRECIO_MAYORISTA) +
        ' <span class="iva">+ IVA</span></div></div>';
    if (!sold) {
        html += waitlist
            ? '<div class="stock-hint wait">Sin stock · sujeto a confirmar</div>'
            : p.PREVENTA_MOSTRAR_STOCK
              ? '<div class="stock-hint' +
                (p.STOCK_PREVENTA <= 2 ? " low" : "") +
                '">' +
                (p.STOCK_PREVENTA === 1
                    ? "Queda 1 disponible"
                    : "Quedan " + p.STOCK_PREVENTA + " disponibles") +
                "</div>"
              : "";
    }
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
            "',1)\">+</button></div>";
        html +=
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
            "</button></div>";
        if (multiplo > 1)
            html +=
                '<div class="multiplo-hint">Múltiplo de ' + multiplo + "</div>";
    }
    html += "</div></div>";
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
        (sold
            ? ' <span class="badge">AGOTADO</span>'
            : waitlist
              ? ' <span class="badge badge-wait">LISTA DE ESPERA</span>'
              : "") +
        (activePreventa === "TODAS" && p.PREVENTA_NOMBRE
            ? '<div class="badge-preventa" style="margin-top:4px">' + p.PREVENTA_NOMBRE + "</div>"
            : "") +
        "</div></div>";
    html += "</div>";
    html +=
        '<div class="lc-price">' +
        fmt(p.PRECIO_MAYORISTA) +
        ' <span class="iva">+ IVA</span></div>';
    if (!sold) {
        html += waitlist
            ? '<div class="stock-hint wait">Sujeto a confirmar</div>'
            : p.PREVENTA_MOSTRAR_STOCK
              ? '<div class="stock-hint' +
                (p.STOCK_PREVENTA <= 2 ? " low" : "") +
                '">' +
                (p.STOCK_PREVENTA === 1
                    ? "Queda 1"
                    : "Quedan " + p.STOCK_PREVENTA) +
                "</div>"
              : "";
    }
    if (sold) {
        html += '<div style="color:#aaa;font-size:11px">No disponible</div>';
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
        '" alt="" onerror="this.style.display=\'none\'"></td>';
    html +=
        '<td><span class="code">' +
        p.CODIGO +
        "</span>" +
        (sold
            ? ' <span class="badge">AGOTADO</span>'
            : waitlist
              ? ' <span class="badge badge-wait">LISTA DE ESPERA</span>'
              : "") +
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
    if (sold) {
        html +=
            '<td colspan="2"><span style="color:#aaa;font-size:12px">No disponible</span></td>';
    } else {
        html +=
            '<td>' +
            (waitlist
                ? '<div class="stock-hint wait">Sujeto a confirmar</div>'
                : p.PREVENTA_MOSTRAR_STOCK
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
        btn.onclick = function () {
            addOrUpdate(code);
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
