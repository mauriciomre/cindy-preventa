var API = "../api.php";
var UPLOAD = "../upload.php";
var authUser = "",
    authPass = "";
var allProducts = [],
    allCats = [],
    allColores = [];
var pendingFile = null,
    codigoOk = true,
    checkTimeout = null;
var editMode = false,
    dragSrc = null;
var sortedProducts = null;

// Columnas visibles — persistidas en localStorage
var COLS = [
    { key: "handle", label: "Orden", default: true },
    { key: "img", label: "Imagen", default: true },
    { key: "codigo", label: "Código", default: true },
    { key: "desc", label: "Descripción", default: true },
    { key: "cat", label: "Categoría", default: true },
    { key: "may", label: "Mayorista", default: true },
    { key: "pvp", label: "PVP", default: true },
    { key: "estado", label: "Estado", default: true },
    { key: "stock", label: "Stock preventa", default: true },
    { key: "multiplo", label: "Múltiplo", default: true },
    { key: "barras", label: "Cód. Barras", default: false },
    { key: "colores", label: "Colores", default: true },
    { key: "acciones", label: "Acciones", default: true },
];
var visibleCols = {};
function loadColPrefs() {
    try {
        var saved = JSON.parse(localStorage.getItem("tb_cols") || "{}");
        COLS.forEach(function (c) {
            visibleCols[c.key] =
                saved[c.key] !== undefined ? saved[c.key] : c.default;
        });
    } catch (e) {
        COLS.forEach(function (c) {
            visibleCols[c.key] = c.default;
        });
    }
}
function saveColPrefs() {
    localStorage.setItem("tb_cols", JSON.stringify(visibleCols));
}
function openColModal() {
    var html = "";
    COLS.forEach(function (c) {
        html +=
            '<label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer">';
        html +=
            '<input type="checkbox" ' +
            (visibleCols[c.key] ? "checked" : "") +
            " onchange=\"visibleCols['" +
            c.key +
            "']=this.checked\"> " +
            c.label;
        html += "</label>";
    });
    document.getElementById("colModalBody").innerHTML = html;
    document.getElementById("colModalBg").classList.add("open");
}
function closeColModal() {
    document.getElementById("colModalBg").classList.remove("open");
}
function applyColModal() {
    saveColPrefs();
    closeColModal();
    renderTable(getFiltered());
}
loadColPrefs();

// ── AUTH ──────────────────────────────────────────────────────────────────────
async function doLogin() {
    var u = document.getElementById("luser").value.trim();
    var p = document.getElementById("lpass").value.trim();
    if (!u || !p) {
        document.getElementById("lerr").textContent = "Completá los campos";
        return;
    }
    var btn = document.querySelector("#loginWrap button");
    btn.disabled = true;
    btn.textContent = "Ingresando...";
    document.getElementById("lerr").textContent = "";
    try {
        var res = await fetch(API + "?action=login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user: u, pass: p }),
        });
        if (res.ok) {
            authUser = u;
            authPass = p;
            localStorage.setItem("tb_admin_user", u);
            localStorage.setItem("tb_admin_pass", p);
            btn.textContent = "Cargando datos...";
            await loadCats();
            await loadColores();
            await loadProducts();
            loadConfig();
            loadTransportes();
            document.getElementById("loginWrap").style.display = "none";
            document.getElementById("appWrap").style.display = "block";
            initSidebar();
            loadFavs();
            renderFavbar();
            checkLastImport();
            loadPendientesManagerBadge();
        } else {
            document.getElementById("lerr").textContent =
                "Usuario o contraseña incorrectos";
            btn.disabled = false;
            btn.textContent = "Ingresar";
        }
    } catch (e) {
        document.getElementById("lerr").textContent = "Error de conexión";
        btn.disabled = false;
        btn.textContent = "Ingresar";
    }
}
function doLogout() {
    localStorage.removeItem("tb_admin_user");
    localStorage.removeItem("tb_admin_pass");
    location.reload();
}
async function tryAutoLogin() {
    var u = localStorage.getItem("tb_admin_user");
    var p = localStorage.getItem("tb_admin_pass");
    if (!u || !p) return;
    try {
        var res = await fetch(API + "?action=login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user: u, pass: p }),
        });
        if (res.ok) {
            authUser = u;
            authPass = p;
            await loadCats();
            await loadColores();
            await loadProducts();
            loadConfig();
            loadTransportes();
            document.getElementById("loginWrap").style.display = "none";
            document.getElementById("appWrap").style.display = "block";
            initSidebar();
            loadFavs();
            renderFavbar();
            checkLastImport();
            loadPendientesManagerBadge();
        } else {
            localStorage.removeItem("tb_admin_user");
            localStorage.removeItem("tb_admin_pass");
        }
    } catch (e) {}
}
document.addEventListener("DOMContentLoaded", function () {
    tryAutoLogin();
});

// ── SIDEBAR ───────────────────────────────────────────────────────────────────
var sidebarCollapsed = localStorage.getItem("tb_sidebar") === "collapsed";

function initSidebar() {
    if (sidebarCollapsed)
        document.getElementById("sidebar").classList.add("collapsed");
}

function toggleSidebar() {
    var sb = document.getElementById("sidebar");
    sidebarCollapsed = !sidebarCollapsed;
    sb.classList.toggle("collapsed", sidebarCollapsed);
    localStorage.setItem(
        "tb_sidebar",
        sidebarCollapsed ? "collapsed" : "expanded",
    );
}

// ── FAVORITOS ─────────────────────────────────────────────────────────────────
var ALL_SECTIONS = [
    { key: "productos", label: "Productos", icon: "📋" },
    { key: "categorias", label: "Categorías", icon: "🗂" },
    { key: "colores", label: "Colores", icon: "🎨" },
    { key: "pedidos", label: "Pedidos", icon: "🛒" },
    { key: "clientes", label: "Clientes", icon: "👤" },
    { key: "configuracion", label: "Configuración", icon: "⚙️" },
];
var favSections = [];

function loadFavs() {
    try {
        favSections = JSON.parse(
            localStorage.getItem("tb_favs") || '["productos","pedidos"]',
        );
    } catch (e) {
        favSections = ["productos", "pedidos"];
    }
}
function saveFavs() {
    localStorage.setItem("tb_favs", JSON.stringify(favSections));
}

function renderFavbar() {
    var bar = document.getElementById("favbar");
    bar.innerHTML = favSections
        .map(function (key) {
            var s = ALL_SECTIONS.find(function (x) {
                return x.key === key;
            });
            if (!s) return "";
            return (
                '<button class="fav-btn" data-section="' +
                key +
                '" onclick="showSection(\'' +
                key +
                "',this)\">" +
                s.icon +
                " " +
                s.label +
                "</button>"
            );
        })
        .join("");
}

function openFavModal() {
    loadFavs();
    var html = ALL_SECTIONS.map(function (s) {
        var checked = favSections.indexOf(s.key) >= 0;
        return (
            '<label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer">' +
            '<input type="checkbox" value="' +
            s.key +
            '" ' +
            (checked ? "checked" : "") +
            "> " +
            s.icon +
            " " +
            s.label +
            "</label>"
        );
    }).join("");
    document.getElementById("favModalBody").innerHTML = html;
    document.getElementById("favModalBg").classList.add("open");
}
function closeFavModal() {
    document.getElementById("favModalBg").classList.remove("open");
}
function applyFavModal() {
    favSections = [];
    document
        .querySelectorAll("#favModalBody input:checked")
        .forEach(function (cb) {
            favSections.push(cb.value);
        });
    saveFavs();
    renderFavbar();
    closeFavModal();
}

// ── NAVEGACIÓN ────────────────────────────────────────────────────────────────
function showSection(s, btn) {
    document
        .querySelectorAll(".section")
        .forEach((el) => el.classList.remove("on"));
    document
        .querySelectorAll(".sidebar-item")
        .forEach((el) => el.classList.remove("on"));
    document
        .querySelectorAll(".fav-btn")
        .forEach((el) => el.classList.remove("on"));
    var secEl = document.getElementById(
        "sec" + s.charAt(0).toUpperCase() + s.slice(1),
    );
    if (secEl) secEl.classList.add("on");
    // Marcar sidebar item activo
    document
        .querySelectorAll('.sidebar-item[data-section="' + s + '"]')
        .forEach((el) => el.classList.add("on"));
    // Marcar fav activo
    document
        .querySelectorAll('.fav-btn[data-section="' + s + '"]')
        .forEach((el) => el.classList.add("on"));
    if (s === "categorias") renderCatTable();
    if (s === "colores") renderColoresTable();
    if (s === "pedidos") loadPedidos();
    if (s === "clientes") loadClientes();
    if (s === "pendientesManager") loadPendientesManager();
    if (s === "configuracion") loadSyncStatus();
}

// ── CONFIGURACIÓN ─────────────────────────────────────────────────────────────
async function loadConfig() {
    var res = await fetch(API + "?action=config_get");
    var cfg = await res.json();
    if (cfg.whatsapp) document.getElementById("cfgWA").value = cfg.whatsapp;
}
async function saveWA() {
    var val = document.getElementById("cfgWA").value.trim();
    if (!val) {
        toast("Ingresá un número", "#c62828");
        return;
    }
    var res = await fetch(API + "?action=config_set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            _user: authUser,
            _pass: authPass,
            clave: "whatsapp",
            valor: val,
        }),
    });
    var json = await res.json();
    if (json.ok) toast("Número de WhatsApp actualizado");
    else toast("Error al guardar", "#c62828");
}
async function savePassword() {
    var actual = document.getElementById("cfgPassActual").value.trim();
    var nueva = document.getElementById("cfgPassNueva").value.trim();
    var confirma = document.getElementById("cfgPassConfirma").value.trim();
    if (!actual || !nueva || !confirma) {
        toast("Completá todos los campos", "#c62828");
        return;
    }
    if (actual !== authPass) {
        toast("La contraseña actual es incorrecta", "#c62828");
        return;
    }
    if (nueva !== confirma) {
        toast("Las contraseñas nuevas no coinciden", "#c62828");
        return;
    }
    if (nueva.length < 6) {
        toast("La contraseña debe tener al menos 6 caracteres", "#c62828");
        return;
    }
    var res = await fetch(API + "?action=cambiar_password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _user: authUser, _pass: authPass, nueva }),
    });
    var json = await res.json();
    if (json.ok) {
        authPass = nueva;
        toast("Contraseña actualizada");
        document.getElementById("cfgPassActual").value = "";
        document.getElementById("cfgPassNueva").value = "";
        document.getElementById("cfgPassConfirma").value = "";
    } else toast("Error al cambiar contraseña", "#c62828");
}

// ── COLORES ───────────────────────────────────────────────────────────────────
async function loadColores() {
    var res = await fetch(API + "?action=colores");
    allColores = await res.json();
    renderColoresTable();
    renderColorSelector();
}
function renderColoresTable(filter) {
    var el = document.getElementById("coloresTbody");
    if (!el) return;
    var list = allColores;
    if (filter)
        list = list.filter(function (c) {
            return c.nombre.toLowerCase().includes(filter.toLowerCase());
        });
    var html = "";
    list.forEach(function (c) {
        html += "<tr>";
        html +=
            '<td><span style="display:inline-block;width:24px;height:24px;border-radius:50%;background:' +
            c.hex +
            ';border:1.5px solid rgba(0,0,0,.15);vertical-align:middle"></span></td>';
        html += "<td><strong>" + c.nombre + "</strong></td>";
        html += "<td><code>" + c.hex + "</code></td>";
        html +=
            '<td><div class="actions"><button class="btn btn-edit" onclick="openColorModal(' +
            c.id +
            ')">✏ Editar</button>';
        html +=
            '<button class="btn btn-danger" onclick="eliminarColor(' +
            c.id +
            ",'" +
            c.nombre +
            "')\">🗑</button></div></td>";
        html += "</tr>";
    });
    el.innerHTML =
        html ||
        '<tr><td colspan="4" style="text-align:center;color:#aaa;padding:20px">No hay colores</td></tr>';
}
function renderColorSelector(filter) {
    var el = document.getElementById("fColores");
    if (!el) return;
    el.innerHTML = "";
    var list = allColores;
    if (filter)
        list = list.filter(function (c) {
            return c.nombre.toLowerCase().includes(filter.toLowerCase());
        });
    list.forEach(function (c) {
        var item = document.createElement("label");
        item.className = "color-option";
        item.innerHTML =
            '<input type="checkbox" value="' +
            c.id +
            '"> <span class="color-dot-admin" style="background:' +
            c.hex +
            '"></span> <span>' +
            c.nombre +
            "</span>";
        el.appendChild(item);
    });
}
async function crearColorDesdeModal() {
    var nombre = document
        .getElementById("quickColorNombre")
        .value.trim()
        .toUpperCase();
    var hex = document.getElementById("quickColorHex").value.trim();
    if (!nombre || !hex) {
        toast("Ingresá nombre y color", "#c62828");
        return;
    }
    // Guardar checks actuales
    var checked = [];
    document
        .querySelectorAll("#fColores input[type=checkbox]:checked")
        .forEach(function (cb) {
            checked.push(parseInt(cb.value));
        });
    var res = await fetch(API + "?action=color_crear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _user: authUser, _pass: authPass, nombre, hex }),
    });
    var json = await res.json();
    if (json.ok) {
        document.getElementById("quickColorNombre").value = "";
        toast("Color creado");
        await loadColores();
        // Restaurar checks + seleccionar el nuevo
        checked.push(json.id);
        document
            .querySelectorAll("#fColores input[type=checkbox]")
            .forEach(function (cb) {
                cb.checked = checked.indexOf(parseInt(cb.value)) >= 0;
            });
    } else toast("Error: " + (json.error || "ya existe"), "#c62828");
}
async function crearColor() {
    var nombre = document
        .getElementById("newColorNombre")
        .value.trim()
        .toUpperCase();
    var hex = document.getElementById("newColorHex").value.trim();
    if (!nombre || !hex) {
        toast("Ingresá nombre y color", "#c62828");
        return;
    }
    var res = await fetch(API + "?action=color_crear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _user: authUser, _pass: authPass, nombre, hex }),
    });
    var json = await res.json();
    if (json.ok) {
        document.getElementById("newColorNombre").value = "";
        toast("Color creado");
        await loadColores();
    } else toast("Error: " + (json.error || "ya existe"), "#c62828");
}
function openColorModal(id) {
    var c = allColores.find((x) => parseInt(x.id) === parseInt(id));
    if (!c) return;
    document.getElementById("colorEditId").value = c.id;
    document.getElementById("colorEditNombre").value = c.nombre;
    document.getElementById("colorEditHex").value = c.hex;
    document.getElementById("colorModalBg").classList.add("open");
}
function closeColorModal() {
    document.getElementById("colorModalBg").classList.remove("open");
}
async function guardarColor() {
    var id = document.getElementById("colorEditId").value;
    var nombre = document.getElementById("colorEditNombre").value.trim();
    var hex = document.getElementById("colorEditHex").value.trim();
    var res = await fetch(API + "?action=color_editar&id=" + id, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _user: authUser, _pass: authPass, nombre, hex }),
    });
    var json = await res.json();
    if (json.ok) {
        toast("Color actualizado");
        closeColorModal();
        await loadColores();
    } else toast("Error", "#c62828");
}
async function eliminarColor(id, nombre) {
    if (!confirm('¿Eliminar "' + nombre + '"?')) return;
    var res = await fetch(API + "?action=color_eliminar&id=" + id, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _user: authUser, _pass: authPass }),
    });
    var json = await res.json();
    if (json.ok) {
        toast("Color eliminado");
        await loadColores();
    }
}

// ── MODO EDICIÓN ──────────────────────────────────────────────────────────────
function toggleEditMode() {
    editMode = !editMode;
    sortedProducts = null;
    document.getElementById("btnEditMode").classList.toggle("on", editMode);
    document.getElementById("editModeBar").classList.toggle("on", editMode);
    document.getElementById("sortToolbar").style.display = editMode
        ? "flex"
        : "none";
    renderTable(getFiltered());
}

// ── ORDENAMIENTO AUTOMÁTICO DE PRODUCTOS ──────────────────────────────────────
function autoSort(by) {
    var list = (sortedProducts || allProducts).slice();
    if (by === "codigo")
        list.sort(function (a, b) {
            return String(a.codigo).localeCompare(String(b.codigo), undefined, {
                numeric: true,
            });
        });
    else if (by === "precio")
        list.sort(function (a, b) {
            return (
                parseFloat(a.precio_mayorista) - parseFloat(b.precio_mayorista)
            );
        });
    else if (by === "categoria")
        list.sort(function (a, b) {
            return (
                a.categoria.localeCompare(b.categoria) ||
                String(a.codigo).localeCompare(String(b.codigo), undefined, {
                    numeric: true,
                })
            );
        });
    sortedProducts = list;
    renderTableFromList(list);
    document.getElementById("sortSaveBtn").style.display = "inline-block";
    document.getElementById("sortCancelBtn").style.display = "inline-block";
    toast("Vista previa del nuevo orden — guardá para confirmar");
}

async function confirmSortSave() {
    if (!sortedProducts) return;
    var order = sortedProducts.map(function (p, i) {
        return { id: p.id, orden: i };
    });
    var res = await fetch(API + "?action=reordenar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            _user: authUser,
            _pass: authPass,
            orden: order,
        }),
    });
    var json = await res.json();
    if (json.ok) {
        toast("Orden guardado");
        sortedProducts = null;
        document.getElementById("sortSaveBtn").style.display = "none";
        document.getElementById("sortCancelBtn").style.display = "none";
        await loadProducts();
    } else toast("Error al guardar", "#c62828");
}

function cancelSort() {
    sortedProducts = null;
    document.getElementById("sortSaveBtn").style.display = "none";
    document.getElementById("sortCancelBtn").style.display = "none";
    renderTable(getFiltered());
    toast("Ordenamiento descartado");
}

// ── CATEGORÍAS ────────────────────────────────────────────────────────────────
async function loadCats() {
    var res = await fetch(API + "?action=categorias");
    allCats = await res.json();
    renderCatSelector();
    renderCatFilter();
}
function renderCatSelector() {
    var sel = document.getElementById("fCategoria");
    var cur = sel.value;
    sel.innerHTML = '<option value="">— Seleccioná —</option>';
    allCats.forEach(function (c) {
        var o = document.createElement("option");
        o.value = c.nombre;
        o.textContent = c.nombre;
        sel.appendChild(o);
    });
    if (cur) sel.value = cur;
}
function renderCatFilter() {
    var sel = document.getElementById("filtCat");
    var cur = sel.value;
    sel.innerHTML = '<option value="">Todas las categorías</option>';
    allCats.forEach(function (c) {
        var o = document.createElement("option");
        o.value = c.nombre;
        o.textContent = c.nombre;
        sel.appendChild(o);
    });
    if (cur) sel.value = cur;
}

var catDragSrc = null;

function renderCatTable() {
    var html = "";
    allCats.forEach(function (c, i) {
        var count = allProducts.filter((p) => p.categoria === c.nombre).length;
        html += '<tr draggable="true" data-cat-id="' + c.id + '">';
        html += '<td><span class="drag-handle">⠿</span></td>';
        html += "<td><strong>" + c.nombre + "</strong></td>";
        html +=
            "<td>" + count + " producto" + (count !== 1 ? "s" : "") + "</td>";
        html +=
            '<td><div class="actions"><button class="btn btn-edit" onclick="openCatModal(' +
            c.id +
            ')">✏ Editar</button>';
        html +=
            '<button class="btn btn-danger" onclick="eliminarCategoria(' +
            c.id +
            ",'" +
            c.nombre +
            "'," +
            count +
            ')">🗑</button></div></td></tr>';
    });
    document.getElementById("catTbody").innerHTML =
        html ||
        '<tr><td colspan="4" style="text-align:center;color:#aaa;padding:20px">No hay categorías</td></tr>';
    initCatDragDrop();
}

function initCatDragDrop() {
    var rows = document.querySelectorAll('#catTbody tr[draggable="true"]');
    rows.forEach(function (row) {
        row.addEventListener("dragstart", function (e) {
            catDragSrc = row;
            row.classList.add("dragging");
            e.dataTransfer.effectAllowed = "move";
        });
        row.addEventListener("dragend", function () {
            row.classList.remove("dragging");
            document
                .querySelectorAll("#catTbody tr")
                .forEach((r) => r.classList.remove("drag-over"));
        });
        row.addEventListener("dragover", function (e) {
            e.preventDefault();
            document
                .querySelectorAll("#catTbody tr")
                .forEach((r) => r.classList.remove("drag-over"));
            if (row !== catDragSrc) row.classList.add("drag-over");
        });
        row.addEventListener("drop", function (e) {
            e.preventDefault();
            if (catDragSrc && catDragSrc !== row) {
                var tbody = document.getElementById("catTbody");
                var rows = Array.from(tbody.querySelectorAll("tr"));
                var si = rows.indexOf(catDragSrc),
                    di = rows.indexOf(row);
                if (si < di) tbody.insertBefore(catDragSrc, row.nextSibling);
                else tbody.insertBefore(catDragSrc, row);
                saveCatOrder();
            }
            row.classList.remove("drag-over");
        });
    });
}

async function saveCatOrder() {
    var rows = document.querySelectorAll("#catTbody tr[data-cat-id]");
    var order = [];
    rows.forEach(function (r, i) {
        order.push({ id: parseInt(r.dataset.catId), orden: i });
    });
    order.forEach(function (o) {
        var c = allCats.find((c) => c.id === o.id);
        if (c) c.orden = o.orden;
    });
    var res = await fetch(API + "?action=reordenar_categorias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            _user: authUser,
            _pass: authPass,
            orden: order,
        }),
    });
    var json = await res.json();
    if (json.ok) toast("Orden de categorías guardado");
}

async function crearCategoria() {
    var nombre = document
        .getElementById("newCatNombre")
        .value.trim()
        .toUpperCase();
    if (!nombre) {
        toast("Ingresá un nombre", "#c62828");
        return;
    }
    var res = await fetch(API + "?action=categoria_crear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            _user: authUser,
            _pass: authPass,
            nombre,
            orden: allCats.length,
        }),
    });
    var json = await res.json();
    if (json.ok) {
        document.getElementById("newCatNombre").value = "";
        toast("Categoría creada");
        await loadCats();
        renderCatTable();
    } else toast("Error: " + (json.error || "ya existe"), "#c62828");
}
function openCatModal(id) {
    var cat = allCats.find((c) => parseInt(c.id) === parseInt(id));
    if (!cat) return;
    document.getElementById("catEditId").value = cat.id;
    document.getElementById("catEditNombre").value = cat.nombre;
    document.getElementById("catModalBg").classList.add("open");
}
function closeCatModal() {
    document.getElementById("catModalBg").classList.remove("open");
}
async function guardarCategoria() {
    var id = document.getElementById("catEditId").value;
    var nombre = document
        .getElementById("catEditNombre")
        .value.trim()
        .toUpperCase();
    var res = await fetch(API + "?action=categoria_editar&id=" + id, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            _user: authUser,
            _pass: authPass,
            nombre,
            orden: 0,
        }),
    });
    var json = await res.json();
    if (json.ok) {
        toast("Categoría actualizada");
        closeCatModal();
        await loadCats();
        await loadProducts();
        renderCatTable();
    } else toast("Error: " + (json.error || "desconocido"), "#c62828");
}
async function eliminarCategoria(id, nombre, count) {
    if (count > 0) {
        toast("No se puede eliminar: tiene " + count + " productos", "#c62828");
        return;
    }
    if (!confirm('¿Eliminar "' + nombre + '"?')) return;
    var res = await fetch(API + "?action=categoria_eliminar&id=" + id, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _user: authUser, _pass: authPass }),
    });
    var json = await res.json();
    if (json.ok) {
        toast("Categoría eliminada");
        await loadCats();
        renderCatTable();
    }
}

// ── PRODUCTOS ─────────────────────────────────────────────────────────────────
async function loadProducts() {
    var res = await fetch(API + "?action=productos");
    allProducts = await res.json();
    renderStats();
    renderTable(getFiltered());
}
function renderStats() {
    document.getElementById("stTotal").textContent = allProducts.length;
    document.getElementById("stDisp").textContent = allProducts.filter(
        (p) => p.estado === "DISPONIBLE",
    ).length;
    document.getElementById("stAgot").textContent = allProducts.filter(
        (p) => p.estado === "AGOTADO",
    ).length;
    document.getElementById("stCats").textContent = allCats.length;
}
function getFiltered() {
    var q = document.getElementById("srch").value.toLowerCase();
    var cat = document.getElementById("filtCat").value;
    var est = document.getElementById("filtEst").value;
    var base = sortedProducts || allProducts;
    return base.filter(
        (p) =>
            (!q ||
                p.descripcion.toLowerCase().includes(q) ||
                p.codigo.toLowerCase().includes(q) ||
                (p.codigo_barras && p.codigo_barras.toLowerCase().includes(q))) &&
            (!cat || p.categoria === cat) &&
            (!est || p.estado === est),
    );
}
function filterTable() {
    renderTable(getFiltered());
}
function fmt(v) {
    return v ? "$ " + Math.round(parseFloat(v)).toLocaleString("es-AR") : "—";
}
function fmtInput(v) {
    return v ? Math.round(parseFloat(v)) : "";
}
function getImgUrl(p) {
    var v = p.updated_at ? new Date(p.updated_at).getTime() : Date.now();
    if (p.foto && p.foto.startsWith("http")) return p.foto + "?v=" + v;
    if (p.foto) return "../" + p.foto + "?v=" + v;
    return "../imgs/" + p.codigo.replace(/\//g, "_") + ".jpeg" + "?v=" + v;
}
function esc(s) {
    return String(s || "")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;");
}

function renderTable(list) {
    renderTableFromList(list);
}

function col(key) {
    return visibleCols[key] !== false;
}

function renderTableHeader() {
    var h = "<thead><tr>";
    if (col("handle")) h += "<th></th>";
    if (col("img")) h += "<th>Img</th>";
    if (col("codigo")) h += "<th>Código</th>";
    if (col("desc")) h += "<th>Descripción</th>";
    if (col("cat")) h += "<th>Categoría</th>";
    if (col("may")) h += "<th>Mayorista</th>";
    if (col("pvp")) h += "<th>PVP</th>";
    if (col("estado")) h += "<th>Estado</th>";
    if (col("stock")) h += "<th>Stock preventa</th>";
    if (col("multiplo")) h += "<th>Múltiplo</th>";
    if (col("barras")) h += "<th>Cód. Barras</th>";
    if (col("colores")) h += "<th>Colores</th>";
    if (col("acciones")) h += "<th>Acciones</th>";
    h += "</tr></thead>";
    document.querySelector("#mainTable thead") &&
        (document.querySelector("#mainTable thead").outerHTML = h);
}

function renderTableFromList(list) {
    renderTableHeader();
    var html = "";
    list.forEach(function (p) {
        var imgUrl = getImgUrl(p);
        var multiplo = p.multiplo || 1;
        var colores = p.colores || [];
        var colspan = COLS.filter(function (c) {
            return visibleCols[c.key] !== false;
        }).length;
        html +=
            '<tr draggable="' +
            (editMode ? "true" : "false") +
            '" data-id="' +
            p.id +
            '" data-orden="' +
            (p.orden || 0) +
            '">';
        if (col("handle"))
            html +=
                "<td>" +
                (editMode ? '<span class="drag-handle">⠿</span>' : "") +
                "</td>";
        if (col("img"))
            html +=
                '<td><img class="thumb" src="' +
                imgUrl +
                '" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"><div class="thumb-ph" style="display:none">📦</div></td>';
        if (editMode) {
            if (col("codigo"))
                html +=
                    '<td class="editing"><input class="inline-input" value="' +
                    esc(p.codigo) +
                    '" data-field="codigo" data-id="' +
                    p.id +
                    '" style="width:90px"></td>';
            if (col("desc"))
                html +=
                    '<td class="editing"><input class="inline-input" value="' +
                    esc(p.descripcion) +
                    '" data-field="descripcion" data-id="' +
                    p.id +
                    '" style="width:180px"></td>';
            if (col("cat"))
                html +=
                    '<td class="editing"><select class="inline-select" data-field="categoria" data-id="' +
                    p.id +
                    '">' +
                    allCats
                        .map(
                            (c) =>
                                '<option value="' +
                                c.nombre +
                                '"' +
                                (c.nombre === p.categoria ? " selected" : "") +
                                ">" +
                                c.nombre +
                                "</option>",
                        )
                        .join("") +
                    "</select></td>";
            if (col("may"))
                html +=
                    '<td class="editing"><input class="inline-input" type="number" value="' +
                    fmtInput(p.precio_mayorista) +
                    '" data-field="precio_mayorista" data-id="' +
                    p.id +
                    '" style="width:90px"></td>';
            if (col("pvp"))
                html +=
                    '<td class="editing"><input class="inline-input" type="number" value="' +
                    fmtInput(p.pvp) +
                    '" data-field="pvp" data-id="' +
                    p.id +
                    '" style="width:90px"></td>';
            if (col("estado"))
                html +=
                    '<td class="editing"><select class="inline-select" data-field="estado" data-id="' +
                    p.id +
                    '"><option' +
                    (p.estado === "DISPONIBLE" ? " selected" : "") +
                    ">DISPONIBLE</option><option" +
                    (p.estado === "AGOTADO" ? " selected" : "") +
                    ">AGOTADO</option></select></td>";
            if (col("stock"))
                html +=
                    '<td class="editing"><input class="inline-input" type="number" value="' +
                    (p.stock_preventa || 0) +
                    '" data-field="stock_preventa" data-id="' +
                    p.id +
                    '" style="width:70px" min="0"></td>';
            if (col("multiplo"))
                html +=
                    '<td class="editing"><input class="inline-input" type="number" value="' +
                    multiplo +
                    '" data-field="multiplo" data-id="' +
                    p.id +
                    '" style="width:60px" min="1"></td>';
            if (col("barras"))
                html +=
                    '<td style="color:var(--muted);font-size:11px">' +
                    (p.codigo_barras || "—") +
                    "</td>";
            if (col("colores"))
                html +=
                    '<td style="color:var(--muted);font-size:11px">' +
                    (colores.length
                        ? colores
                              .map(function (c) {
                                  return (
                                      '<span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:' +
                                      c.hex +
                                      ';border:1px solid rgba(0,0,0,.15);margin-right:2px" title="' +
                                      c.nombre +
                                      '"></span>'
                                  );
                              })
                              .join("")
                        : "—") +
                    "</td>";
            if (col("acciones"))
                html +=
                    '<td><button class="inline-save" onclick="saveInline(' +
                    p.id +
                    ')">💾</button></td>';
        } else {
            if (col("codigo")) html += "<td><code>" + p.codigo + "</code></td>";
            if (col("desc")) html += "<td>" + p.descripcion + "</td>";
            if (col("cat")) html += "<td>" + p.categoria + "</td>";
            if (col("may"))
                html +=
                    '<td style="font-weight:800;color:var(--blue)">' +
                    fmt(p.precio_mayorista) +
                    "</td>";
            if (col("pvp")) html += "<td>" + fmt(p.pvp) + "</td>";
            if (col("estado"))
                html +=
                    '<td><span class="badge-' +
                    (p.estado === "DISPONIBLE" ? "disp" : "agot") +
                    '">' +
                    p.estado +
                    "</span></td>";
            if (col("stock"))
                html +=
                    "<td>" +
                    (p.stock_preventa > 0
                        ? '<strong>' + p.stock_preventa + '</strong> disponibles'
                        : '<span style="color:var(--muted);font-style:italic">Lista de espera</span>') +
                    "</td>";
            if (col("multiplo"))
                html +=
                    '<td style="color:var(--muted);font-size:12px">×' +
                    multiplo +
                    "</td>";
            if (col("barras"))
                html +=
                    '<td style="color:var(--muted);font-size:11px">' +
                    (p.codigo_barras || "—") +
                    "</td>";
            if (col("colores"))
                html +=
                    "<td>" +
                    (colores.length
                        ? colores
                              .map(function (c) {
                                  return (
                                      '<span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:' +
                                      c.hex +
                                      ';border:1px solid rgba(0,0,0,.15);margin-right:2px" title="' +
                                      c.nombre +
                                      '"></span>'
                                  );
                              })
                              .join("")
                        : '<span style="color:#ccc">—</span>') +
                    "</td>";
            if (col("acciones")) {
                html +=
                    '<td><div class="actions"><button class="btn btn-edit" onclick="editProduct(' +
                    p.id +
                    ')">✏ Editar</button>';
                html +=
                    '<button class="btn btn-danger" onclick="deleteProduct(' +
                    p.id +
                    ",'" +
                    p.descripcion.replace(/'/g, "") +
                    "')\">🗑</button></div></td>";
            }
        }
        html += "</tr>";
    });
    document.getElementById("tbody").innerHTML =
        html ||
        '<tr><td colspan="11" style="text-align:center;color:#aaa;padding:30px">No hay productos</td></tr>';
    if (editMode) initDragDrop();
}

// ── GUARDAR TODO ──────────────────────────────────────────────────────────────
async function saveAllInline() {
    var rows = document.querySelectorAll("#tbody tr[data-id]");
    if (!rows.length) return;
    var btn = document.querySelector("#editModeBar .btn-primary");
    btn.disabled = true;
    btn.textContent = "Guardando...";
    var errors = 0;
    for (var row of rows) {
        var id = parseInt(row.dataset.id);
        var p = allProducts.find((p) => p.id === id);
        if (!p) continue;
        var data = { _user: authUser, _pass: authPass, orden: p.orden || 0 };
        row.querySelectorAll("[data-field]").forEach(function (el) {
            data[el.dataset.field] = el.value;
        });
        if (
            !data.codigo ||
            !data.descripcion ||
            !data.categoria ||
            !data.precio_mayorista
        ) {
            errors++;
            continue;
        }
        var res = await fetch(API + "?action=editar&id=" + id, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        var json = await res.json();
        if (!json.ok) errors++;
    }
    btn.disabled = false;
    btn.textContent = "💾 Guardar todo";
    if (errors === 0) {
        toast("Todos los cambios guardados");
        await loadProducts();
    } else toast(errors + " error(s) al guardar", "#c62828");
}

// ── INLINE SAVE ───────────────────────────────────────────────────────────────
async function saveInline(id) {
    var p = allProducts.find((p) => p.id === id);
    if (!p) return;
    var row = document.querySelector('tr[data-id="' + id + '"]');
    if (!row) return;
    var data = { _user: authUser, _pass: authPass, orden: p.orden || 0 };
    row.querySelectorAll("[data-field]").forEach(function (el) {
        data[el.dataset.field] = el.value;
    });
    if (
        !data.codigo ||
        !data.descripcion ||
        !data.categoria ||
        !data.precio_mayorista
    ) {
        toast("Completá todos los campos", "#c62828");
        return;
    }
    var res = await fetch(API + "?action=editar&id=" + id, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    var json = await res.json();
    if (json.ok) {
        toast("Guardado");
        await loadProducts();
    } else toast("Error: " + (json.error || "desconocido"), "#c62828");
}

// ── DRAG & DROP PRODUCTOS ─────────────────────────────────────────────────────
function initDragDrop() {
    var rows = document.querySelectorAll('#tbody tr[draggable="true"]');
    rows.forEach(function (row) {
        // Solo arrastrar desde el handle (primera celda)
        var handle = row.querySelector(".drag-handle");
        if (handle) {
            handle.addEventListener("mousedown", function () {
                row.draggable = true;
            });
            row.addEventListener("dragend", function () {
                row.draggable = false;
            });
        }
        row.draggable = false; // deshabilitado por defecto, se activa solo desde el handle

        row.addEventListener("dragstart", function (e) {
            dragSrc = row;
            row.classList.add("dragging");
            e.dataTransfer.effectAllowed = "move";
        });
        row.addEventListener("dragend", function () {
            row.classList.remove("dragging");
            document
                .querySelectorAll("#tbody tr")
                .forEach((r) => r.classList.remove("drag-over"));
        });
        row.addEventListener("dragover", function (e) {
            e.preventDefault();
            document
                .querySelectorAll("#tbody tr")
                .forEach((r) => r.classList.remove("drag-over"));
            if (row !== dragSrc) row.classList.add("drag-over");
        });
        row.addEventListener("drop", function (e) {
            e.preventDefault();
            if (dragSrc && dragSrc !== row) {
                var tbody = document.getElementById("tbody");
                var rows = Array.from(tbody.querySelectorAll("tr"));
                var si = rows.indexOf(dragSrc),
                    di = rows.indexOf(row);
                if (si < di) tbody.insertBefore(dragSrc, row.nextSibling);
                else tbody.insertBefore(dragSrc, row);
                saveOrder();
            }
            row.classList.remove("drag-over");
        });
    });

    // Deshabilitar scroll del mouse en inputs numéricos
    document
        .querySelectorAll('#tbody input[type="number"]')
        .forEach(function (inp) {
            inp.addEventListener(
                "wheel",
                function (e) {
                    e.preventDefault();
                },
                { passive: false },
            );
        });
}
async function saveOrder() {
    var rows = document.querySelectorAll("#tbody tr[data-id]");
    var order = [];
    rows.forEach(function (r, i) {
        order.push({ id: parseInt(r.dataset.id), orden: i });
    });
    order.forEach(function (o) {
        var p = allProducts.find((p) => p.id === o.id);
        if (p) p.orden = o.orden;
    });
    var res = await fetch(API + "?action=reordenar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            _user: authUser,
            _pass: authPass,
            orden: order,
        }),
    });
    var json = await res.json();
    if (json.ok) toast("Orden guardado");
}

// ── MODAL PRODUCTO ────────────────────────────────────────────────────────────
function openModal(p) {
    pendingFile = null;
    codigoOk = !!p;
    document.getElementById("modalTitle").textContent = p
        ? "Editar producto"
        : "Nuevo producto";
    document.getElementById("fId").value = p ? p.id : "";
    document.getElementById("fFotoActual").value = p ? p.foto || "" : "";
    document.getElementById("fCodigo").value = p ? p.codigo : "";
    document.getElementById("fCodigo").className = "";
    document.getElementById("codigoHint").textContent = p
        ? "✓ Código existente"
        : "";
    document.getElementById("codigoHint").className = p
        ? "field-hint ok"
        : "field-hint";
    renderCatSelector();
    setTimeout(function () {
        document.getElementById("fCategoria").value = p ? p.categoria : "";
    }, 0);
    document.getElementById("fDesc").value = p ? p.descripcion : "";
    document.getElementById("fMay").value = p
        ? Math.round(p.precio_mayorista)
        : "";
    document.getElementById("fPvp").value = p
        ? p.pvp
            ? Math.round(p.pvp)
            : ""
        : "";
    document.getElementById("fEstado").value = p ? p.estado : "DISPONIBLE";
    document.getElementById("fMultiplo").value = p ? p.multiplo || 1 : 1;
    document.getElementById("fStockPreventa").value = p
        ? p.stock_preventa || 0
        : 0;
    var stockHint = document.getElementById("stockPreventaHint");
    if (p) {
        stockHint.textContent =
            "Cargado en total: " +
            (p.stock_preventa_inicial || 0) +
            " · Vendido/reservado hasta ahora: " +
            ((p.stock_preventa_inicial || 0) - (p.stock_preventa || 0));
    } else {
        stockHint.textContent =
            'Unidades reservables antes de que llegue la mercadería. En 0, el producto sigue visible como "lista de espera".';
    }
    document.getElementById("btnStockAgregar").disabled = !p;
    document.getElementById("btnStockAgregar").style.opacity = p ? 1 : 0.5;
    document.getElementById("fCodigoBarras").value = p ? (p.codigo_barras || "") : "";
    // Colores
    renderColorSelector();
    var productColores = p
        ? (p.colores || []).map(function (c) {
              return c.id;
          })
        : [];
    setTimeout(function () {
        document
            .querySelectorAll("#fColores input[type=checkbox]")
            .forEach(function (cb) {
                cb.checked = productColores.indexOf(parseInt(cb.value)) >= 0;
            });
    }, 0);
    document.getElementById("fImagen").value = "";
    document.getElementById("imgPreview").classList.remove("show");
    var cur = document.getElementById("imgCurrent");
    if (p) {
        cur.src = getImgUrl(p);
        cur.style.display = "block";
        document.getElementById("imgLabelText").innerHTML =
            "📷 Cambiar imagen<br><small>JPG, PNG o WebP — máx. 5MB</small>";
    } else {
        cur.style.display = "none";
        document.getElementById("imgLabelText").innerHTML =
            "📷 Hacé clic o arrastrá una imagen<br><small>JPG, PNG o WebP — máx. 5MB</small>";
    }
    document.getElementById("modalBg").classList.add("open");
}
function closeModal() {
    document.getElementById("modalBg").classList.remove("open");
}
function editProduct(id) {
    openModal(allProducts.find((p) => p.id === id));
}

function previewImg(input) {
    if (!input.files || !input.files[0]) return;
    pendingFile = input.files[0];
    var reader = new FileReader();
    reader.onload = function (e) {
        var prev = document.getElementById("imgPreview");
        prev.src = e.target.result;
        prev.classList.add("show");
        document.getElementById("imgLabelText").textContent =
            "✓ " + pendingFile.name;
        document.getElementById("imgCurrent").style.display = "none";
    };
    reader.readAsDataURL(pendingFile);
}

function checkCodigo(input) {
    var codigo = input.value.trim();
    var hint = document.getElementById("codigoHint");
    var currentId = document.getElementById("fId").value;
    var editingProduct = currentId
        ? allProducts.find((p) => p.id == currentId)
        : null;
    if (editingProduct && editingProduct.codigo === codigo) {
        hint.textContent = "✓ Código existente";
        hint.className = "field-hint ok";
        input.className = "ok";
        codigoOk = true;
        return;
    }
    clearTimeout(checkTimeout);
    if (!codigo) {
        hint.textContent = "";
        hint.className = "field-hint";
        input.className = "";
        codigoOk = false;
        return;
    }
    hint.textContent = "Verificando...";
    hint.className = "field-hint";
    checkTimeout = setTimeout(async function () {
        var res = await fetch(
            API +
                "?action=check_codigo&codigo=" +
                encodeURIComponent(codigo) +
                "&exclude_id=" +
                (currentId || 0),
        );
        var json = await res.json();
        if (json.exists) {
            hint.textContent = "✗ Este código ya existe";
            hint.className = "field-hint err";
            input.className = "err";
            codigoOk = false;
        } else {
            hint.textContent = "✓ Código disponible";
            hint.className = "field-hint ok";
            input.className = "ok";
            codigoOk = true;
        }
    }, 400);
}

async function uploadImage(codigo) {
    if (!pendingFile) return null;
    var fd = new FormData();
    fd.append("imagen", pendingFile);
    fd.append("codigo", codigo);
    fd.append("_user", authUser);
    fd.append("_pass", authPass);
    document.getElementById("uploadProgress").style.display = "block";
    document.getElementById("uploadBar").style.width = "40%";
    try {
        var res = await fetch(UPLOAD, { method: "POST", body: fd });
        document.getElementById("uploadBar").style.width = "100%";
        var json = await res.json();
        setTimeout(() => {
            document.getElementById("uploadProgress").style.display = "none";
            document.getElementById("uploadBar").style.width = "0";
        }, 400);
        if (json.ok) return json.url;
        toast("Error al subir imagen: " + json.error, "#c62828");
        return null;
    } catch (e) {
        toast("Error al subir imagen", "#c62828");
        return null;
    }
}

async function saveProduct() {
    if (!codigoOk) {
        toast("Verificá el código del producto", "#c62828");
        return;
    }
    var id = document.getElementById("fId").value;
    var codigo = document.getElementById("fCodigo").value.trim();
    var descripcion = document.getElementById("fDesc").value.trim();
    var categoria = document.getElementById("fCategoria").value;
    var may = document.getElementById("fMay").value;
    var pvp = document.getElementById("fPvp").value;
    var multiplo = Math.max(
        1,
        parseInt(document.getElementById("fMultiplo").value) || 1,
    );
    var codigoBarras = document.getElementById("fCodigoBarras").value.trim() || null;
    var stockPreventa = Math.max(
        0,
        parseInt(document.getElementById("fStockPreventa").value) || 0,
    );
    if (!codigo || !descripcion || !categoria || !may || !pvp) {
        toast("Todos los campos son obligatorios", "#c62828");
        return;
    }
    // Colores seleccionados
    var colores = [];
    document
        .querySelectorAll("#fColores input[type=checkbox]:checked")
        .forEach(function (cb) {
            colores.push(parseInt(cb.value));
        });
    var btn = document.getElementById("btnGuardar");
    btn.disabled = true;
    btn.textContent = "Guardando...";
    var fotoUrl = document.getElementById("fFotoActual").value || null;
    if (pendingFile) {
        var up = await uploadImage(codigo);
        if (up) fotoUrl = up;
    }
    if (!fotoUrl && !id) {
        fotoUrl = "imgs/" + codigo.replace(/\//g, "_") + ".jpeg";
    }
    var orden = id
        ? (
              allProducts.find(function (p) {
                  return p.id == id;
              }) || {}
          ).orden || 0
        : 0;
    var data = {
        _user: authUser,
        _pass: authPass,
        codigo,
        descripcion,
        categoria,
        precio_mayorista: parseFloat(may) || 0,
        pvp: parseFloat(pvp) || null,
        foto: fotoUrl,
        estado: document.getElementById("fEstado").value,
        orden: orden,
        multiplo,
        codigo_barras: codigoBarras,
        stock_preventa: stockPreventa,
        colores,
    };
    var res = await fetch(
        API + "?action=" + (id ? "editar&id=" + id : "producto"),
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        },
    );
    var json = await res.json();
    btn.disabled = false;
    btn.textContent = "Guardar";
    if (json.ok) {
        toast(id ? "Producto actualizado" : "Producto creado");
        closeModal();
        await loadProducts();
    } else toast("Error: " + (json.error || "desconocido"), "#c62828");
}

async function agregarStockDesdeModal() {
    var id = document.getElementById("fId").value;
    if (!id) {
        toast("Guardá el producto primero para poder sumarle stock", "#c62828");
        return;
    }
    var cantidadStr = prompt("¿Cuántas unidades querés sumar al stock de preventa?");
    if (cantidadStr === null) return;
    var cantidad = parseInt(cantidadStr);
    if (!cantidad || cantidad <= 0) {
        toast("Ingresá una cantidad válida (mayor a 0)", "#c62828");
        return;
    }
    var res = await fetch(API + "?action=stock_agregar&id=" + id, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _user: authUser, _pass: authPass, cantidad }),
    });
    var json = await res.json();
    if (json.ok) {
        document.getElementById("fStockPreventa").value = json.stock_preventa;
        document.getElementById("stockPreventaHint").textContent =
            "Cargado en total: " +
            json.stock_preventa_inicial +
            " · Vendido/reservado hasta ahora: " +
            (json.stock_preventa_inicial - json.stock_preventa);
        toast("Se sumaron " + cantidad + " unidades");
        await loadProducts();
    } else toast("Error: " + (json.error || "desconocido"), "#c62828");
}

async function deleteProduct(id, name) {
    if (!confirm('¿Eliminar "' + name + '"?')) return;
    var res = await fetch(API + "?action=eliminar&id=" + id, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _user: authUser, _pass: authPass }),
    });
    var json = await res.json();
    if (json.ok) {
        toast("Producto eliminado");
        await loadProducts();
    }
}

async function importarData() {
    if (!confirm("Importar los productos del catálogo original.\n¿Continuar?"))
        return;
    var res = await fetch(API + "?action=importar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            creds: { user: authUser, pass: authPass },
            productos: DATA_INICIAL,
        }),
    });
    var json = await res.json();
    toast("Importados: " + json.imported + " productos");
    await loadCats();
    await loadProducts();
}

function toast(msg, bg) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.style.background = bg || "#2e7d32";
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 3000);
}

// ── TRANSPORTES ───────────────────────────────────────────────────────────────
var allTransportes = [];
async function loadTransportes() {
    var res = await fetch(API + "?action=transportes");
    allTransportes = await res.json();
    renderTransTable();
}
function renderTransTable() {
    var el = document.getElementById("transTbody");
    if (!el) return;
    var html = "";
    allTransportes.forEach(function (t) {
        html += "<tr><td><strong>" + t.nombre + "</strong></td>";
        html +=
            '<td><div class="actions"><button class="btn btn-edit" onclick="openTransModal(' +
            t.id +
            ')">✏ Editar</button>';
        html +=
            '<button class="btn btn-danger" onclick="eliminarTransporte(' +
            t.id +
            ",'" +
            t.nombre +
            "')\">🗑</button></div></td></tr>";
    });
    el.innerHTML =
        html ||
        '<tr><td colspan="2" style="text-align:center;color:#aaa;padding:20px">No hay transportes</td></tr>';
}
async function crearTransporte() {
    var nombre = document
        .getElementById("newTransNombre")
        .value.trim()
        .toUpperCase();
    if (!nombre) {
        toast("Ingresá un nombre", "#c62828");
        return;
    }
    var res = await fetch(API + "?action=transporte_crear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            _user: authUser,
            _pass: authPass,
            nombre,
            orden: allTransportes.length,
        }),
    });
    var json = await res.json();
    if (json.ok) {
        document.getElementById("newTransNombre").value = "";
        toast("Transporte creado");
        await loadTransportes();
    } else toast("Error: " + (json.error || "ya existe"), "#c62828");
}
function openTransModal(id) {
    var t = allTransportes.find((x) => parseInt(x.id) === parseInt(id));
    if (!t) return;
    document.getElementById("transEditId").value = t.id;
    document.getElementById("transEditNombre").value = t.nombre;
    document.getElementById("transModalBg").classList.add("open");
}
function closeTransModal() {
    document.getElementById("transModalBg").classList.remove("open");
}
async function guardarTransporte() {
    var id = document.getElementById("transEditId").value;
    var nombre = document
        .getElementById("transEditNombre")
        .value.trim()
        .toUpperCase();
    var res = await fetch(API + "?action=transporte_editar&id=" + id, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _user: authUser, _pass: authPass, nombre }),
    });
    var json = await res.json();
    if (json.ok) {
        toast("Transporte actualizado");
        closeTransModal();
        await loadTransportes();
    } else toast("Error", "#c62828");
}
async function eliminarTransporte(id, nombre) {
    if (!confirm('¿Eliminar "' + nombre + '"?')) return;
    var res = await fetch(API + "?action=transporte_eliminar&id=" + id, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _user: authUser, _pass: authPass }),
    });
    var json = await res.json();
    if (json.ok) {
        toast("Transporte eliminado");
        await loadTransportes();
    }
}

// ── PEDIDOS ───────────────────────────────────────────────────────────────────
var allPedidos = [];
var pedidoActual = null;

async function loadPedidos() {
    var q = document.getElementById("pedidoSrch").value;
    var est = document.getElementById("pedidoFiltEst").value;
    var url = API + "?action=pedidos";
    if (est === "TODOS_CON_ELIMINADOS") {
        url += "&vista=todos";
    } else if (est === "ELIMINADO") {
        url += "&vista=eliminados";
    } else {
        url += "&vista=activos";
        if (est) url += "&estado=" + encodeURIComponent(est);
    }
    if (q) url += "&q=" + encodeURIComponent(q);
    var res = await fetch(url);
    allPedidos = await res.json();
    renderPedidosTable();
}
function filterPedidos() {
    loadPedidos();
}

var ESTADO_LABELS = {
    PENDIENTE: { label: "Pendiente", color: "#e65100", bg: "#fff3e0" },
    EN_PREPARACION: {
        label: "En preparación",
        color: "#1565c0",
        bg: "#e3f2fd",
    },
    FACTURADO: { label: "Facturado", color: "#2e7d32", bg: "#e8f5e9" },
    ENVIADO: { label: "Enviado", color: "#6a1b9a", bg: "#f3e5f5" },
    ELIMINADO: { label: "Eliminado", color: "#999", bg: "#f5f5f5" },
};

function estadoBadge(est) {
    var e = ESTADO_LABELS[est] || { label: est, color: "#666", bg: "#f5f5f5" };
    return (
        '<span style="background:' +
        e.bg +
        ";color:" +
        e.color +
        ';padding:3px 10px;border-radius:10px;font-size:11px;font-weight:700">' +
        e.label +
        "</span>"
    );
}

function renderPedidosTable() {
    var html = "";
    allPedidos.forEach(function (p) {
        var fecha = new Date(p.created_at).toLocaleString("es-AR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
        var eliminado = p.estado === "ELIMINADO";
        html += "<tr" + (eliminado ? ' style="opacity:.5"' : "") + ">";
        html += "<td><strong>#" + p.id + "</strong></td>";
        html +=
            '<td style="font-size:12px;white-space:nowrap">' + fecha + "</td>";
        html +=
            '<td><button class="link-btn" onclick="abrirClienteDesdePedido(' +
            p.cliente_id +
            ')">' +
            p.cliente_nombre +
            "</button></td>";
        html +=
            '<td><a href="https://wa.me/' +
            p.cliente_tel +
            '" target="_blank" style="color:var(--blue);text-decoration:none">+' +
            p.cliente_tel +
            "</a></td>";
        html +=
            '<td style="font-weight:800;color:var(--blue)">' +
            fmt(p.total) +
            "</td>";
        html += "<td>" + estadoBadge(p.estado) + "</td>";
        html +=
            '<td><div class="actions"><button class="btn btn-edit" onclick="openPedidoModal(' +
            p.id +
            ')">Ver</button>';
        if (eliminado)
            html +=
                '<button class="btn" style="background:#e8f5e9;color:#2e7d32;padding:6px 12px;font-size:12px" onclick="restaurarPedido(' +
                p.id +
                ')">↩ Restaurar</button>';
        else
            html +=
                '<button class="btn btn-danger" onclick="eliminarPedido(' +
                p.id +
                ')">🗑</button>';
        html += "</div></td>";
        html += "</tr>";
    });
    document.getElementById("pedidosTbody").innerHTML =
        html ||
        '<tr><td colspan="7" style="text-align:center;color:#aaa;padding:30px">No hay pedidos</td></tr>';
}

async function eliminarPedido(id) {
    if (!confirm("¿Marcar este pedido como eliminado?")) return;
    var res = await fetch(API + "?action=pedido_eliminar&id=" + id, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _user: authUser, _pass: authPass }),
    });
    var json = await res.json();
    if (json.ok) {
        toast("Pedido eliminado");
        loadPedidos();
    } else toast("Error", "#c62828");
}

async function restaurarPedido(id) {
    var res = await fetch(API + "?action=pedido_restaurar&id=" + id, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _user: authUser, _pass: authPass }),
    });
    var json = await res.json();
    if (json.ok) {
        toast("Pedido restaurado");
        loadPedidos();
    } else toast("Error", "#c62828");
}

function abrirClienteDesdePedido(clienteId) {
    showSection(
        "clientes",
        document.querySelector('.sidebar-item[data-section="clientes"]'),
    );
    setTimeout(async function () {
        await loadClientes();
        openClienteModal(clienteId);
    }, 100);
}

async function openPedidoModal(id) {
    var res = await fetch(API + "?action=pedido_detalle&id=" + id);
    pedidoActual = await res.json();
    document.getElementById("pedidoModalTitle").textContent = "Pedido #" + id;
    var p = pedidoActual;
    var fecha = new Date(p.created_at).toLocaleString("es-AR");
    var html =
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">';
    html +=
        '<div><div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;margin-bottom:4px">Cliente</div>';
    html += "<strong>" + p.cliente_nombre + "</strong><br>";
    html +=
        '<a href="https://wa.me/' +
        p.cliente_tel +
        '" target="_blank">+' +
        p.cliente_tel +
        "</a>";
    if (p.cuit_dni) html += "<br>" + p.cuit_dni;
    if (p.email) html += "<br>" + p.email;
    html += "</div>";
    html +=
        '<div><div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;margin-bottom:4px">Envío</div>';
    if (p.domicilio) html += p.domicilio + "<br>";
    if (p.localidad) html += p.localidad + " (" + (p.cp || "") + ")<br>";
    if (p.provincia) html += p.provincia + "<br>";
    if (p.transporte) html += "🚚 " + p.transporte;
    html += "</div></div>";
    // Estado
    html +=
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding:12px;background:#f8f9fb;border-radius:8px">';
    html += '<span style="font-weight:700;font-size:13px">Estado:</span>';
    html +=
        '<select id="pedidoEstadoSel" style="padding:6px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px">';
    ["PENDIENTE", "EN_PREPARACION", "FACTURADO", "ENVIADO"].forEach(
        function (est) {
            html +=
                '<option value="' +
                est +
                '"' +
                (p.estado === est ? " selected" : "") +
                ">" +
                (ESTADO_LABELS[est] ? ESTADO_LABELS[est].label : est) +
                "</option>";
        },
    );
    html += "</select>";
    html +=
        '<button class="btn btn-primary" style="padding:6px 14px;font-size:12px" onclick="cambiarEstadoPedido()">Actualizar</button>';
    html +=
        '<span style="font-size:12px;color:var(--muted)">' + fecha + "</span>";
    html += "</div>";
    // Historial estados
    if (p.historial && p.historial.length) {
        html +=
            '<div style="margin-bottom:16px"><div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:8px">Historial de estados</div>';
        p.historial.forEach(function (h) {
            var fh = new Date(h.created_at).toLocaleString("es-AR");
            html +=
                '<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)">' +
                estadoBadge(h.estado) +
                ' <span style="color:var(--muted);margin-left:8px">' +
                fh +
                "</span></div>";
        });
        html += "</div>";
    }
    // Items
    html +=
        '<table style="width:100%;margin-bottom:16px"><thead><tr><th>Código</th><th>Descripción</th><th>Cant.</th><th>Precio</th><th>Subtotal</th><th>Stock</th></tr></thead><tbody>';
    p.items.forEach(function (item) {
        html +=
            "<tr><td><code>" +
            item.codigo +
            "</code></td><td>" +
            item.descripcion +
            '</td><td style="text-align:center">' +
            item.cantidad +
            "</td><td>" +
            fmt(item.precio_unitario) +
            '</td><td style="font-weight:700">' +
            fmt(item.subtotal) +
            "</td><td>" +
            (item.en_lista_espera == 1
                ? '<span class="badge-agot">⏳ LISTA DE ESPERA</span>'
                : '<span class="badge-disp">✓ Confirmado</span>') +
            "</td></tr>";
    });
    html += "</tbody></table>";
    html +=
        '<div style="text-align:right;font-size:18px;font-weight:800;color:var(--blue);margin-bottom:16px">TOTAL: ' +
        fmt(p.total) +
        "</div>";
    // Facturas y observaciones
    html +=
        '<div class="field"><label>Números de factura (separados por coma)</label><input id="pedidoFacturas" value="' +
        (p.facturas || "") +
        '" placeholder="FA-0001, FB-0002..."></div>';
    html +=
        '<div class="field"><label>Observaciones internas</label><textarea id="pedidoObs" rows="3" style="width:100%;padding:9px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit">' +
        (p.observaciones || "") +
        "</textarea></div>";
    document.getElementById("pedidoModalBody").innerHTML = html;
    document.getElementById("pedidoModalBg").classList.add("open");
}
function closePedidoModal() {
    document.getElementById("pedidoModalBg").classList.remove("open");
    pedidoActual = null;
}

async function cambiarEstadoPedido() {
    if (!pedidoActual) return;
    var estado = document.getElementById("pedidoEstadoSel").value;
    var res = await fetch(API + "?action=pedido_estado&id=" + pedidoActual.id, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _user: authUser, _pass: authPass, estado }),
    });
    var json = await res.json();
    if (json.ok) {
        toast("Estado actualizado");
        pedidoActual.estado = estado;
        loadPedidos();
        openPedidoModal(pedidoActual.id);
    } else toast("Error", "#c62828");
}

async function guardarPedidoObs() {
    if (!pedidoActual) return;
    var obs = document.getElementById("pedidoObs").value;
    var facturas = document.getElementById("pedidoFacturas").value;
    var res = await fetch(
        API + "?action=pedido_actualizar&id=" + pedidoActual.id,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                _user: authUser,
                _pass: authPass,
                observaciones: obs,
                facturas,
            }),
        },
    );
    var json = await res.json();
    if (json.ok) toast("Guardado");
    else toast("Error", "#c62828");
}

function imprimirPedido() {
    if (!pedidoActual) return;
    var p = pedidoActual;
    var fecha = new Date(p.created_at).toLocaleString("es-AR");
    var html = "<html><head><title>Pedido #" + p.id + "</title><style>";
    html += "body{font-family:Arial,sans-serif;padding:20px;font-size:13px}";
    html += "h1{font-size:18px;margin-bottom:4px}";
    html +=
        ".info{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;padding:12px;background:#f5f5f5;border-radius:8px;font-size:13px}";
    html += "table{width:100%;border-collapse:collapse;margin-bottom:16px}";
    html +=
        "th{background:#003087;color:#fff;padding:7px 8px;text-align:left;font-size:12px}";
    html +=
        "td{padding:7px 8px;border-bottom:1px solid #eee;font-size:12px;vertical-align:top}";
    html += "td.desc{max-width:180px;word-wrap:break-word}";
    html += ".price-cell{white-space:nowrap;font-size:11px}";
    html += ".price-unit{color:#666}";
    html += ".price-sub{font-weight:bold;color:#003087}";
    html +=
        ".deposit-box{display:inline-block;width:36px;height:26px;border:2px solid #333;vertical-align:middle}";
    html +=
        ".total{text-align:right;font-size:16px;font-weight:bold;color:#003087;margin-top:8px}";
    html +=
        ".footer{margin-top:24px;padding-top:16px;border-top:1px solid #ccc;display:grid;grid-template-columns:1fr 1fr;gap:16px}";
    html +=
        ".firma{border-top:1px solid #333;margin-top:50px;padding-top:6px;font-size:11px;color:#666}";
    html += "@media print{body{padding:10px}}";
    html += "</style></head><body>";
    html += "<h1>Pedido #" + p.id + " — Cindy Mayorista (Preventa)</h1>";
    html +=
        '<p style="color:#666;font-size:12px;margin-bottom:16px">Fecha: ' +
        fecha +
        "</p>";
    html += '<div class="info">';
    html +=
        "<div><strong>Cliente:</strong> " +
        p.cliente_nombre +
        "<br><strong>Tel:</strong> +" +
        p.cliente_tel;
    if (p.cuit_dni) html += "<br><strong>CUIT/DNI:</strong> " + p.cuit_dni;
    html += "</div>";
    html += "<div>";
    if (p.domicilio) html += "<strong>Envío:</strong> " + p.domicilio + "<br>";
    if (p.localidad) html += p.localidad + " (" + (p.cp || "") + ")<br>";
    if (p.provincia) html += p.provincia + "<br>";
    if (p.transporte) html += "<strong>Transporte:</strong> " + p.transporte;
    html += "</div></div>";
    html += "<table><thead><tr>";
    html +=
        '<th>Código</th><th>Descripción</th><th style="text-align:center">Cant.</th>';
    html += '<th style="text-align:left">Precio / Subtotal</th>';
    html += '<th style="text-align:center;width:60px">Central</th>';
    html += '<th style="text-align:center;width:60px">Seppey</th>';
    html += "</tr></thead><tbody>";
    p.items.forEach(function (item) {
        html += "<tr>";
        html += '<td style="white-space:nowrap">' + item.codigo + "</td>";
        html += '<td class="desc">' + item.descripcion + "</td>";
        html +=
            '<td style="text-align:center;font-weight:bold">' +
            item.cantidad +
            "</td>";
        html +=
            '<td class="price-cell"><span class="price-unit">' +
            fmt(item.precio_unitario) +
            '</span><br><span class="price-sub">' +
            fmt(item.subtotal) +
            "</span></td>";
        html +=
            '<td style="text-align:center"><span class="deposit-box"></span></td>';
        html +=
            '<td style="text-align:center"><span class="deposit-box"></span></td>';
        html += "</tr>";
    });
    html += "</tbody></table>";
    html +=
        '<div class="total">TOTAL: ' +
        fmt(p.total) +
        " — " +
        p.items.length +
        " código" +
        (p.items.length !== 1 ? "s" : "") +
        " diferentes</div>";
    if (p.observaciones)
        html +=
            '<div style="margin-top:12px;padding:10px;background:#fffde7;border-radius:6px;font-size:12px"><strong>Observaciones:</strong> ' +
            p.observaciones +
            "</div>";
    html +=
        '<div class="footer"><div><p style="font-size:12px;color:#666">Preparado por:</p><div class="firma">Nombre y firma</div></div></div>';
    html += "</body></html>";
    var w = window.open("", "_blank");
    w.document.write(html);
    w.document.close();
    w.print();
}

// ── CLIENTES ──────────────────────────────────────────────────────────────────
var allClientesAdmin = [];

var CLIENT_COLS = [
    { key: "nombre", label: "Nombre" },
    { key: "telefono", label: "Teléfono" },
    { key: "cuit_dni", label: "CUIT / DNI" },
    { key: "email", label: "Email" },
    { key: "localidad", label: "Localidad" },
    { key: "provincia", label: "Provincia" },
    { key: "domicilio", label: "Domicilio" },
    { key: "cp", label: "CP" },
    { key: "transporte", label: "Transporte" },
    { key: "notas", label: "Notas" },
    { key: "pedidos", label: "Pedidos" },
    { key: "acciones", label: "Acciones" },
];
var visibleClientCols = {};
function loadClientColPrefs() {
    try {
        var saved = JSON.parse(localStorage.getItem("tb_client_cols") || "{}");
        CLIENT_COLS.forEach(function (c) {
            visibleClientCols[c.key] =
                saved[c.key] !== undefined ? saved[c.key] : true;
        });
    } catch (e) {
        CLIENT_COLS.forEach(function (c) {
            visibleClientCols[c.key] = true;
        });
    }
}
function saveClientColPrefs() {
    localStorage.setItem("tb_client_cols", JSON.stringify(visibleClientCols));
}
loadClientColPrefs();

function openClientColModal() {
    var html = CLIENT_COLS.map(function (c) {
        return (
            '<label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer">' +
            '<input type="checkbox" value="' +
            c.key +
            '" ' +
            (visibleClientCols[c.key] ? "checked" : "") +
            " onchange=\"visibleClientCols['" +
            c.key +
            "']=this.checked\"> " +
            c.label +
            "</label>"
        );
    }).join("");
    document.getElementById("clientColModalBody").innerHTML = html;
    document.getElementById("clientColModalBg").classList.add("open");
}
function closeClientColModal() {
    document.getElementById("clientColModalBg").classList.remove("open");
}
function applyClientColModal() {
    saveClientColPrefs();
    closeClientColModal();
    renderClientesTable();
}

function ccol(key) {
    return visibleClientCols[key] !== false;
}

async function loadClientes() {
    var q = document.getElementById("clienteSrch").value;
    var vista = document.getElementById("clienteFiltVista")
        ? document.getElementById("clienteFiltVista").value
        : "activos";
    var url = API + "?action=clientes&vista=" + vista;
    if (q) url += "&q=" + encodeURIComponent(q);
    var res = await fetch(url);
    allClientesAdmin = await res.json();
    renderClientesTable();
}
function filterClientes() {
    loadClientes();
}

function renderClientesTable() {
    // Header dinámico
    var thead = "<tr>";
    CLIENT_COLS.forEach(function (c) {
        if (ccol(c.key)) thead += "<th>" + c.label + "</th>";
    });
    thead += "</tr>";
    document.getElementById("clientesThead").innerHTML = thead;

    var html = "";
    allClientesAdmin.forEach(function (c) {
        var eliminado = parseInt(c.eliminado) === 1;
        html += "<tr" + (eliminado ? ' style="opacity:.5"' : "") + ">";
        if (ccol("nombre"))
            html += "<td><strong>" + c.nombre + "</strong></td>";
        if (ccol("telefono"))
            html +=
                '<td><a href="https://wa.me/' +
                c.telefono +
                '" target="_blank" style="color:var(--blue);text-decoration:none">+' +
                c.telefono +
                "</a></td>";
        if (ccol("cuit_dni")) html += "<td>" + (c.cuit_dni || "—") + "</td>";
        if (ccol("email")) html += "<td>" + (c.email || "—") + "</td>";
        if (ccol("localidad")) html += "<td>" + (c.localidad || "—") + "</td>";
        if (ccol("provincia")) html += "<td>" + (c.provincia || "—") + "</td>";
        if (ccol("domicilio")) html += "<td>" + (c.domicilio || "—") + "</td>";
        if (ccol("cp")) html += "<td>" + (c.cp || "—") + "</td>";
        if (ccol("transporte"))
            html += "<td>" + (c.transporte || "—") + "</td>";
        if (ccol("notas"))
            html +=
                '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
                (c.notas || "—") +
                "</td>";
        if (ccol("pedidos"))
            html +=
                '<td style="text-align:center"><button class="link-btn" onclick="verPedidosCliente(' +
                c.id +
                "," +
                c.cliente_nombre_esc +
                ')">' +
                (c.total_pedidos || 0) +
                "</button></td>";
        if (ccol("acciones")) {
            html +=
                '<td><div class="actions"><button class="btn btn-edit" onclick="openClienteModal(' +
                c.id +
                ')">✏ Editar</button>';
            if (eliminado)
                html +=
                    '<button class="btn" style="background:#e8f5e9;color:#2e7d32;padding:6px 12px;font-size:12px" onclick="restaurarCliente(' +
                    c.id +
                    ')">↩</button>';
            else
                html +=
                    '<button class="btn btn-danger" onclick="eliminarCliente(' +
                    c.id +
                    ",'" +
                    c.nombre.replace(/'/g, "") +
                    "')\">🗑</button>";
            html += "</div></td>";
        }
        html += "</tr>";
    });
    document.getElementById("clientesTbody").innerHTML =
        html ||
        '<tr><td colspan="12" style="text-align:center;color:#aaa;padding:30px">No hay clientes</td></tr>';
}

function verPedidosCliente(clienteId) {
    showSection(
        "pedidos",
        document.querySelector('.sidebar-item[data-section="pedidos"]'),
    );
    setTimeout(async function () {
        document.getElementById("pedidoSrch").value = "";
        document.getElementById("pedidoFiltEst").value = "";
        var url = API + "?action=pedidos&vista=activos&cliente_id=" + clienteId;
        var res = await fetch(url);
        allPedidos = await res.json();
        renderPedidosTable();
    }, 100);
}

async function eliminarCliente(id, nombre) {
    if (!confirm('¿Eliminar al cliente "' + nombre + '"?')) return;
    var res = await fetch(API + "?action=cliente_eliminar&id=" + id, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _user: authUser, _pass: authPass }),
    });
    var json = await res.json();
    if (json.ok) {
        toast("Cliente eliminado");
        loadClientes();
    } else toast("Error", "#c62828");
}

async function restaurarCliente(id) {
    var res = await fetch(API + "?action=cliente_restaurar&id=" + id, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _user: authUser, _pass: authPass }),
    });
    var json = await res.json();
    if (json.ok) {
        toast("Cliente restaurado");
        loadClientes();
    } else toast("Error", "#c62828");
}

function openNuevoClienteModal() {
    document.getElementById("clienteEditId").value = "";
    document.getElementById("ceNombre").value = "";
    document.getElementById("ceCuitDni").value = "";
    document.getElementById("ceEmail").value = "";
    document.getElementById("ceTelefono").value = "";
    document.getElementById("ceDomicilio").value = "";
    document.getElementById("ceLocalidad").value = "";
    document.getElementById("ceCP").value = "";
    document.getElementById("ceProvincia").value = "";
    document.getElementById("ceTransporte").value = "";
    document.getElementById("ceNotas").value = "";
    document.getElementById("clienteModalBg").classList.add("open");
}

function openClienteModal(id) {
    var c = allClientesAdmin.find(function (x) {
        return parseInt(x.id) === parseInt(id);
    });
    if (!c) return;
    document.getElementById("clienteEditId").value = c.id;
    document.getElementById("ceNombre").value = c.nombre || "";
    document.getElementById("ceCuitDni").value = c.cuit_dni || "";
    document.getElementById("ceEmail").value = c.email || "";
    document.getElementById("ceTelefono").value = c.telefono || "";
    document.getElementById("ceDomicilio").value = c.domicilio || "";
    document.getElementById("ceLocalidad").value = c.localidad || "";
    document.getElementById("ceCP").value = c.cp || "";
    document.getElementById("ceProvincia").value = c.provincia || "";
    document.getElementById("ceTransporte").value = c.transporte || "";
    document.getElementById("ceNotas").value = c.notas || "";
    document.getElementById("clienteModalBg").classList.add("open");
}
function closeClienteModal() {
    document.getElementById("clienteModalBg").classList.remove("open");
}

async function guardarClienteEdit() {
    var id = document.getElementById("clienteEditId").value;
    var tel = document.getElementById("ceTelefono").value.trim();
    var nombre = document.getElementById("ceNombre").value.trim();
    if (!nombre) {
        toast("El nombre es obligatorio", "#c62828");
        return;
    }
    var data = {
        _user: authUser,
        _pass: authPass,
        nombre,
        telefono: tel,
        cuit_dni: document.getElementById("ceCuitDni").value.trim(),
        email: document.getElementById("ceEmail").value.trim(),
        domicilio: document.getElementById("ceDomicilio").value.trim(),
        localidad: document.getElementById("ceLocalidad").value.trim(),
        cp: document.getElementById("ceCP").value.trim(),
        provincia: document.getElementById("ceProvincia").value.trim(),
        transporte: document.getElementById("ceTransporte").value.trim(),
        notas: document.getElementById("ceNotas").value.trim(),
    };
    var action = id ? "cliente_editar&id=" + id : "cliente_crear";
    var res = await fetch(API + "?action=" + action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    var json = await res.json();
    if (json.ok) {
        toast(id ? "Cliente actualizado" : "Cliente creado");
        closeClienteModal();
        loadClientes();
    } else toast("Error: " + (json.error || "desconocido"), "#c62828");
}

// ── IMPORTACIÓN MASIVA POR EXCEL (SheetJS) ────────────────────────────────────

function openImportModal() {
    document.getElementById("importModal").classList.add("open");
}

function closeImportModal() {
    document.getElementById("importModal").classList.remove("open");
    // Resetear estado completo
    document.getElementById("importMappingWrap").style.display = "none";
    document.getElementById("importMappingWrap").innerHTML = "";
    document.getElementById("importPreviewWrap").innerHTML = "";
    document.getElementById("importStep1Wrap").style.display = "";
    var fi = document.getElementById("importFileInput");
    if (fi) fi.value = "";
    document.getElementById("btnImportConfirm").disabled = true;
    setImportStep(1);
    _importFilter = "todos";
    window._importRows = [];
    window._importRawRows = [];
    window._importMapping = {};
    window._importEnrichedRows = [];
    window._importExistingData = {};
}

// ── Constantes de importación ──────────────────────────────────────────────
var _importFilter = "todos";

var SYSTEM_FIELDS = [
    { key: "CODIGO",           label: "Código",           required: true },
    { key: "CODIGO_BARRAS",    label: "Código de barras", required: false },
    { key: "DESCRIPCION",      label: "Descripción",      required: false },
    { key: "CATEGORIA",        label: "Categoría",        required: false },
    { key: "PRECIO_MAYORISTA", label: "Precio mayorista", required: false },
    { key: "PVP",              label: "PVP",              required: false },
    { key: "ESTADO",           label: "Estado",           required: false },
];

var FIELD_ALIASES = {
    "CODIGO":           ["CODIGO", "COD", "CODE", "SKU", "ARTICULO", "ITEM"],
    "CODIGO_BARRAS":    ["CODIGO_BARRAS", "CODIGOBARRAS", "BARRAS", "EAN", "EAN13", "BARCODE", "GTIN"],
    "DESCRIPCION":      ["DESCRIPCION", "DESC", "NOMBRE", "PRODUCTO", "NAME", "DESCRIPTION", "DETALLE"],
    "CATEGORIA":        ["CATEGORIA", "CAT", "CATEGORY", "RUBRO", "LINEA", "FAMILIA"],
    "PRECIO_MAYORISTA": ["PRECIO_MAYORISTA", "PRECIO", "PRECIO_MAY", "MAYORISTA", "PRICE", "COSTO", "PRECIO_COSTO"],
    "PVP":              ["PVP", "PRECIO_VENTA", "PRECIO_PUBLICO", "RETAIL", "PRECIO_SUGERIDO"],
    "ESTADO":           ["ESTADO", "STATUS", "STATE", "DISPONIBILIDAD", "ACTIVO"],
};

function normalizeHeader(h) {
    return h.toUpperCase().trim()
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/\s+/g, "_");
}

function autoMap(header) {
    var h = normalizeHeader(header);
    for (var field in FIELD_ALIASES) {
        if (FIELD_ALIASES[field].indexOf(h) >= 0) return field;
    }
    return "";
}

function setImportStep(n) {
    [1, 2, 3].forEach(function(i) {
        var el = document.getElementById("importStep" + i);
        if (!el) return;
        el.style.background = i === n ? "#263494" : "#e8eaf6";
        el.style.color      = i === n ? "#fff"    : "#999";
    });
}

// ── PASO 1 → 2: parsear Excel y mostrar mapeo ──────────────────────────────
function onImportFileChange(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
        try {
            var wb   = XLSX.read(ev.target.result, { type: "binary" });
            var ws   = wb.Sheets[wb.SheetNames[0]];
            var rawRows = XLSX.utils.sheet_to_json(ws, { defval: "" });

            // Normalizar keys (mayúsculas + sin tildes + guiones bajos)
            rawRows = rawRows.map(function(r) {
                var obj = {};
                Object.keys(r).forEach(function(k) {
                    obj[normalizeHeader(k)] = String(r[k]).trim();
                });
                return obj;
            });

            var headers = rawRows.length > 0 ? Object.keys(rawRows[0]) : [];
            if (!headers.length) { toast("El archivo no tiene columnas reconocibles.", "#c62828"); return; }

            window._importRawRows = rawRows;
            window._importHeaders = headers;

            renderMappingStep(headers, rawRows);
        } catch(err) {
            toast("Error leyendo el archivo: " + err.message, "#c62828");
        }
    };
    reader.readAsBinaryString(file);
}

// ── PASO 2: mapeo de columnas ─────────────────────────────────────────────
function renderMappingStep(headers, rawRows) {
    setImportStep(2);
    document.getElementById("importStep1Wrap").style.display = "none";

    // Auto-mapear
    var mapping = {};
    headers.forEach(function(h) { mapping[h] = autoMap(h); });
    window._importMapping = mapping;

    var html = '<p style="font-size:13px;color:#555;margin-bottom:12px">'
        + 'Asigná cada columna de tu archivo al campo del sistema correspondiente. '
        + 'Campos con <strong style="color:#c62828">*</strong> son obligatorios para productos nuevos.</p>';

    html += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">'
        + '<thead><tr>'
        + '<th style="text-align:left;padding:7px 10px;border-bottom:2px solid #eee;color:#888;font-size:11px;text-transform:uppercase;white-space:nowrap">Columna en tu archivo</th>'
        + '<th style="text-align:left;padding:7px 10px;border-bottom:2px solid #eee;color:#888;font-size:11px;text-transform:uppercase">Muestra</th>'
        + '<th style="text-align:left;padding:7px 10px;border-bottom:2px solid #eee;color:#888;font-size:11px;text-transform:uppercase">Campo del sistema</th>'
        + '</tr></thead><tbody>';

    headers.forEach(function(h) {
        var sample = rawRows.slice(0, 3)
            .map(function(r) { return r[h]; })
            .filter(Boolean).join(" · ").slice(0, 50);
        var mapped  = mapping[h] || "";
        var hEsc    = h.replace(/'/g, "\\'");

        html += '<tr style="border-bottom:1px solid #f5f5f5">'
            + '<td style="padding:8px 10px;font-weight:600;white-space:nowrap">' + esc(h) + '</td>'
            + '<td style="padding:8px 10px;color:#999;font-size:12px">' + esc(sample) + '</td>'
            + '<td style="padding:8px 10px">'
            + '<select style="width:100%;padding:5px 8px;border:1px solid #ddd;border-radius:6px;font-size:13px"'
            + ' onchange="window._importMapping[\'' + hEsc + '\']=this.value">'
            + '<option value="">— No importar —</option>';
        SYSTEM_FIELDS.forEach(function(f) {
            var sel = mapped === f.key ? " selected" : "";
            html += '<option value="' + f.key + '"' + sel + '>'
                 + f.label + (f.required ? " *" : "") + '</option>';
        });
        html += '</select></td></tr>';
    });

    html += '</tbody></table></div>'
        + '<button class="btn btn-primary" style="margin-top:16px;width:100%" onclick="applyMapping()">Continuar → Vista previa</button>';

    var wrap = document.getElementById("importMappingWrap");
    wrap.innerHTML = html;
    wrap.style.display = "";
    document.getElementById("btnImportConfirm").disabled = true;
}

// ── PASO 2 → 3: aplicar mapeo y pedir check al servidor ──────────────────
function applyMapping() {
    var mapping = window._importMapping || {};
    var rawRows = window._importRawRows || [];

    // Validar que CODIGO esté mapeado
    var codigoMapped = Object.values(mapping).indexOf("CODIGO") >= 0;
    if (!codigoMapped) { toast("Debés asignar la columna CODIGO antes de continuar.", "#c62828"); return; }

    // Transformar filas usando el mapeo
    var rows = rawRows.map(function(r) {
        var obj = {};
        Object.keys(mapping).forEach(function(h) {
            if (mapping[h]) obj[mapping[h]] = r[h] !== undefined ? String(r[h]).trim() : "";
        });
        return obj;
    }).filter(function(r) { return r["CODIGO"] && r["CODIGO"] !== ""; });

    if (!rows.length) { toast("No hay filas con CODIGO después de aplicar el mapeo.", "#c62828"); return; }
    window._importRows = rows;

    // Ocultar mapeo, mostrar loading
    document.getElementById("importMappingWrap").style.display = "none";
    setImportStep(3);
    document.getElementById("importPreviewWrap").innerHTML =
        '<p style="text-align:center;padding:24px;color:#666">⏳ Analizando productos…</p>';

    // Llamar check_codigos
    var codigos = rows.map(function(r) { return r["CODIGO"]; });
    fetch(API + "?action=check_codigos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _user: authUser, _pass: authPass, codigos: codigos })
    })
    .then(function(res) { return res.json(); })
    .then(function(json) {
        if (json.ok) {
            renderImportPreview(rows, json.productos || {});
        } else {
            toast("Error verificando productos: " + (json.error || ""), "#c62828");
            document.getElementById("importPreviewWrap").innerHTML = "";
        }
    })
    .catch(function(err) {
        toast("Error de conexión: " + err.message, "#c62828");
        document.getElementById("importPreviewWrap").innerHTML = "";
    });
}

// ── PASO 3: preview enriquecido ───────────────────────────────────────────
function getRowStatus(row, existingData) {
    var codigo   = row["CODIGO"];
    var existing = existingData[codigo] || null;
    var errors   = [];

    // Validaciones
    if (!existing) {
        if (!row["DESCRIPCION"]) errors.push("DESCRIPCION requerida");
        if (!row["CATEGORIA"])   errors.push("CATEGORIA requerida");
    }
    if (row["PRECIO_MAYORISTA"] && isNaN(parseFloat(row["PRECIO_MAYORISTA"])))
        errors.push("PRECIO_MAYORISTA no es un número");

    if (errors.length) return { status: "ERROR", errors: errors, existing: existing };
    if (!existing)     return { status: "NUEVO",       errors: [], existing: null };

    // ¿Hay cambios reales?
    var fieldMap = {
        DESCRIPCION:      "descripcion",
        CATEGORIA:        "categoria",
        PRECIO_MAYORISTA: "precio_mayorista",
        PVP:              "pvp",
        ESTADO:           "estado",
        CODIGO_BARRAS:    "codigo_barras",
    };
    var changed = false;
    Object.keys(fieldMap).forEach(function(k) {
        if (row[k] === undefined || row[k] === "") return;
        var newV = String(row[k]).trim();
        var oldV = String(existing[fieldMap[k]] || "").trim();
        if (k === "PRECIO_MAYORISTA" || k === "PVP") {
            if (Math.round(parseFloat(newV) * 100) !== Math.round(parseFloat(oldV) * 100)) changed = true;
        } else if (k === "ESTADO") {
            if (newV.toUpperCase() !== oldV.toUpperCase()) changed = true;
        } else {
            if (newV !== oldV) changed = true;
        }
    });

    return { status: changed ? "ACTUALIZA" : "SIN_CAMBIOS", errors: [], existing: existing };
}

var STATUS_COLORS = {
    NUEVO:       { bg: "#f1f8e9", badge: "#2e7d32", badgeBg: "#c8e6c9" },
    ACTUALIZA:   { bg: "#e3f2fd", badge: "#1565c0", badgeBg: "#bbdefb" },
    ERROR:       { bg: "#ffebee", badge: "#c62828", badgeBg: "#ffcdd2" },
    SIN_CAMBIOS: { bg: "#fafafa", badge: "#757575", badgeBg: "#eeeeee" },
};

function renderImportPreview(rows, existingData) {
    window._importExistingData = existingData;

    // Calcular estado por fila
    var enriched = rows.map(function(r) {
        return Object.assign({}, r, { _status: getRowStatus(r, existingData) });
    });
    window._importEnrichedRows = enriched;

    // Contar por estado
    var counts = { NUEVO: 0, ACTUALIZA: 0, ERROR: 0, SIN_CAMBIOS: 0 };
    enriched.forEach(function(r) { counts[r._status.status]++; });

    // Detectar qué campos vinieron en el archivo
    var ORDERED = ["CODIGO","CODIGO_BARRAS","DESCRIPCION","CATEGORIA","PRECIO_MAYORISTA","PVP","ESTADO"];
    var activeFields = ORDERED.filter(function(f) {
        return rows.some(function(r) { return r[f] !== undefined && r[f] !== ""; });
    });
    window._importFields = activeFields;

    var html = buildImportPreviewHTML(enriched, counts, activeFields);
    document.getElementById("importPreviewWrap").innerHTML = html;

    var importable = counts.NUEVO + counts.ACTUALIZA;
    document.getElementById("btnImportConfirm").disabled = importable === 0;
}

function buildImportPreviewHTML(enriched, counts, activeFields) {
    // Filtrar según tab activo
    var visible = _importFilter === "todos"
        ? enriched
        : enriched.filter(function(r) { return r._status.status === _importFilter; });

    var fieldMap = {
        DESCRIPCION: "descripcion", CATEGORIA: "categoria",
        PRECIO_MAYORISTA: "precio_mayorista", PVP: "pvp",
        ESTADO: "estado", CODIGO_BARRAS: "codigo_barras",
    };

    var html = "";

    // ── Stat tiles ──
    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">';
    html += importStatTile("✅ Nuevos",      counts.NUEVO,       "#1b5e20", "#e8f5e9");
    html += importStatTile("🔄 Actualizan", counts.ACTUALIZA,   "#0d47a1", "#e3f2fd");
    html += importStatTile("❌ Errores",    counts.ERROR,        "#b71c1c", "#ffebee");
    html += importStatTile("⏭ Sin cambios",counts.SIN_CAMBIOS,  "#555",    "#f5f5f5");
    html += '</div>';

    // ── Filter tabs ──
    html += '<div style="display:flex;gap:5px;margin-bottom:10px;flex-wrap:wrap">';
    html += importFilterTab("todos",       "Todos",        enriched.length, counts);
    html += importFilterTab("NUEVO",       "Nuevos",       counts.NUEVO,    counts);
    html += importFilterTab("ACTUALIZA",   "Actualizan",   counts.ACTUALIZA,counts);
    html += importFilterTab("ERROR",       "Errores",      counts.ERROR,    counts);
    html += importFilterTab("SIN_CAMBIOS", "Sin cambios",  counts.SIN_CAMBIOS,counts);
    html += '</div>';

    // ── Tabla con sticky header ──
    html += '<div style="overflow:auto;max-height:320px;border:1px solid #e0e0e0;border-radius:8px">';
    html += '<table class="import-preview-table" style="min-width:100%"><thead><tr>';
    html += '<th style="min-width:90px">Estado</th>';
    activeFields.forEach(function(f) { html += '<th>' + f + '</th>'; });
    html += '</tr></thead><tbody>';

    if (!visible.length) {
        html += '<tr><td colspan="' + (activeFields.length + 1) + '" style="text-align:center;padding:20px;color:#999">Sin filas en este filtro</td></tr>';
    }

    visible.slice(0, 100).forEach(function(r) {
        var st      = r._status;
        var colors  = STATUS_COLORS[st.status];
        var labelMap = { NUEVO: "NUEVO", ACTUALIZA: "ACTUALIZA", ERROR: "ERROR", SIN_CAMBIOS: "SIN CAMBIOS" };

        html += '<tr style="background:' + colors.bg + '">';
        // Badge + errores
        html += '<td style="padding:6px 8px;vertical-align:top">'
            + '<span class="imp-badge" style="background:' + colors.badgeBg + ';color:' + colors.badge + '">'
            + labelMap[st.status] + '</span>';
        if (st.errors.length) {
            html += '<div style="font-size:10px;color:#c62828;margin-top:3px;line-height:1.4">'
                + st.errors.map(function(e) { return "⚠ " + e; }).join("<br>") + '</div>';
        }
        html += '</td>';

        // Celdas de datos
        activeFields.forEach(function(f) {
            var val    = r[f] !== undefined ? String(r[f]) : "";
            var dbKey  = fieldMap[f];
            var oldVal = (st.existing && dbKey) ? String(st.existing[dbKey] || "").trim() : "";
            var cellBg = "";

            // Celda de error: requerida vacía en producto nuevo
            if (st.status === "ERROR" && !val && (f === "DESCRIPCION" || f === "CATEGORIA") && !st.existing) {
                html += '<td style="background:#ffcdd2;color:#c62828;font-size:11px;padding:6px 8px">⚠ vacío</td>';
                return;
            }

            // Before/after en actualizaciones
            if (st.status === "ACTUALIZA" && val && dbKey && oldVal && oldVal !== val) {
                var numFields = ["PRECIO_MAYORISTA", "PVP"];
                var reallyChanged = numFields.indexOf(f) >= 0
                    ? Math.round(parseFloat(val) * 100) !== Math.round(parseFloat(oldVal) * 100)
                    : val.toUpperCase() !== oldVal.toUpperCase();
                if (reallyChanged) {
                    html += '<td style="padding:6px 8px;font-size:12px">'
                        + '<span style="text-decoration:line-through;color:#aaa">' + esc(oldVal) + '</span>'
                        + ' → <strong>' + esc(val) + '</strong></td>';
                    return;
                }
            }

            html += '<td style="padding:6px 8px">' + esc(val) + '</td>';
        });

        html += '</tr>';
    });

    if (visible.length > 100) {
        html += '<tr><td colspan="' + (activeFields.length + 1) + '" style="text-align:center;padding:10px;color:#999;font-size:12px">… y '
            + (visible.length - 100) + ' filas más</td></tr>';
    }

    html += '</tbody></table></div>';

    if (counts.ERROR > 0) {
        html += '<p style="font-size:12px;color:#c62828;margin-top:8px">⚠ Las '
            + counts.ERROR + ' fila(s) con error no serán importadas.</p>';
    }
    if (counts.SIN_CAMBIOS > 0) {
        html += '<p style="font-size:12px;color:#888;margin-top:4px">⏭ Las '
            + counts.SIN_CAMBIOS + ' fila(s) sin cambios serán omitidas.</p>';
    }

    return html;
}

function importStatTile(label, count, color, bg) {
    return '<div style="background:' + bg + ';border-radius:8px;padding:10px 6px;text-align:center">'
        + '<div style="font-size:20px;font-weight:900;color:' + color + '">' + count + '</div>'
        + '<div style="font-size:10px;color:' + color + ';margin-top:2px;font-weight:600;line-height:1.2">' + label + '</div>'
        + '</div>';
}

function importFilterTab(value, label, count, counts) {
    var isActive = _importFilter === value;
    var cls = "imp-tab" + (isActive ? " active" : "");
    return '<button class="' + cls + '" onclick="setImportFilter(\'' + value + '\')">'
        + label + ' (' + count + ')</button>';
}

function setImportFilter(value) {
    _importFilter = value;
    var enriched = window._importEnrichedRows || [];
    var counts = { NUEVO: 0, ACTUALIZA: 0, ERROR: 0, SIN_CAMBIOS: 0 };
    enriched.forEach(function(r) { counts[r._status.status]++; });
    document.getElementById("importPreviewWrap").innerHTML =
        buildImportPreviewHTML(enriched, counts, window._importFields || []);
}

async function confirmImport() {
    var enriched = window._importEnrichedRows || [];
    // Solo importar filas NUEVO y ACTUALIZA
    var rows = enriched
        .filter(function(r) { return r._status.status === "NUEVO" || r._status.status === "ACTUALIZA"; })
        .map(function(r) {
            var clean = Object.assign({}, r);
            delete clean._status;
            return clean;
        });
    if (!rows.length) return;
    var btn = document.getElementById("btnImportConfirm");
    btn.disabled = true;
    btn.textContent = "Importando...";
    try {
        var res = await fetch(API + "?action=importar_masivo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ _user: authUser, _pass: authPass, productos: rows }),
        });
        var json = await res.json();
        if (json.ok) {
            var msg = "✅ " + (json.imported || 0) + " nuevos, " + (json.updated || 0) + " actualizados";
            if (json.errors && json.errors.length) {
                msg += " — " + json.errors.length + " error(es): "
                    + json.errors.map(function(e){ return e.codigo + " (" + e.motivo + ")"; }).join(", ");
            }
            toast(msg, json.errors && json.errors.length ? "#e65100" : undefined);
            closeImportModal();
            loadProducts();
            if (json.import_id) showUndoBanner(json.import_id, json.imported, json.updated);
        } else {
            toast("Error: " + (json.error || "desconocido"), "#c62828");
        }
    } catch (err) {
        toast("Error de red: " + err.message, "#c62828");
    }
    btn.disabled = false;
    btn.textContent = "Confirmar importación";
}

// ── DESHACER IMPORTACIÓN ──────────────────────────────────────────────────────

function showUndoBanner(import_id, imported, updated) {
    var banner = document.getElementById("undoBanner");
    if (!banner) return;
    var d = new Date();
    var hora = d.getHours().toString().padStart(2,"0") + ":" + d.getMinutes().toString().padStart(2,"0");
    banner.innerHTML =
        '<span>↩ Última importación (' + hora + '): ' + (imported||0) + ' nuevos + ' + (updated||0) + ' actualizados. ¿Salió mal?</span>' +
        '<button onclick="undoLastImport(\'' + import_id + '\')">Deshacer importación</button>' +
        '<button onclick="hideUndoBanner()" style="background:transparent;color:inherit;opacity:.6;margin-left:4px">✕</button>';
    banner.style.display = "flex";
    banner._importId = import_id;
}

function hideUndoBanner() {
    var banner = document.getElementById("undoBanner");
    if (banner) banner.style.display = "none";
}

async function undoLastImport(import_id) {
    if (!confirm("¿Seguro que querés revertir la última importación? Los productos vuelven al estado anterior.")) return;
    var banner = document.getElementById("undoBanner");
    if (banner) banner.innerHTML = '<span>⏳ Revirtiendo...</span>';
    try {
        var res = await fetch(API + "?action=import_rollback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ _user: authUser, _pass: authPass, import_id: import_id }),
        });
        var json = await res.json();
        if (json.ok) {
            toast("↩ Importación revertida — " + json.restored + " producto(s) restaurado(s)");
            hideUndoBanner();
            loadProducts();
        } else {
            toast("Error al revertir: " + (json.error || "desconocido"), "#c62828");
            hideUndoBanner();
        }
    } catch (err) {
        toast("Error de red: " + err.message, "#c62828");
        hideUndoBanner();
    }
}

// ── Exportar plantilla vacía ──────────────────────────────────────────────────
function exportTemplate() {
    if (typeof XLSX === 'undefined') { alert('Cargando SheetJS, intentá de nuevo.'); return; }
    var headers = ['CODIGO', 'CODIGO_BARRAS', 'DESCRIPCION', 'CATEGORIA', 'PRECIO_MAYORISTA', 'PVP', 'ESTADO'];
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet([headers]);
    // Ancho de columna aproximado
    ws['!cols'] = [
        {wch: 14}, {wch: 16}, {wch: 40}, {wch: 22},
        {wch: 18}, {wch: 12}, {wch: 12}
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Productos');
    XLSX.writeFile(wb, 'plantilla_importacion_travelblue.xlsx');
}

// ── Exportar catálogo completo ────────────────────────────────────────────────
async function exportCatalog() {
    if (typeof XLSX === 'undefined') { alert('Cargando SheetJS, intentá de nuevo.'); return; }
    try {
        var res  = await fetch(API + '?action=productos');
        var json = await res.json();
        if (!Array.isArray(json) || !json.length) { alert('No hay productos para exportar.'); return; }
        var headers = ['CODIGO', 'CODIGO_BARRAS', 'DESCRIPCION', 'CATEGORIA', 'PRECIO_MAYORISTA', 'PVP', 'ESTADO'];
        var rows = json.map(function(p) {
            return [
                p.codigo        || '',
                p.codigo_barras || '',
                p.descripcion   || '',
                p.categoria     || '',
                p.precio_mayorista != null ? Number(p.precio_mayorista) : '',
                p.pvp           != null    ? Number(p.pvp)              : '',
                p.estado        || ''
            ];
        });
        var wb = XLSX.utils.book_new();
        var ws = XLSX.utils.aoa_to_sheet([headers].concat(rows));
        ws['!cols'] = [
            {wch: 14}, {wch: 16}, {wch: 40}, {wch: 22},
            {wch: 18}, {wch: 12}, {wch: 12}
        ];
        XLSX.utils.book_append_sheet(wb, ws, 'Productos');
        var fecha = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, 'catalogo_travelblue_' + fecha + '.xlsx');
    } catch(e) {
        alert('Error al exportar: ' + e.message);
    }
}

// ── Imprimir nota de pedido (admin — carga desde API) ────────────────────────
async function printNotaAdmin() {
    try {
        var res  = await fetch(API + '?action=productos');
        var json = await res.json();
        if (!Array.isArray(json) || !json.length) { alert('No hay productos para imprimir.'); return; }
        // Guardamos todos (disponibles + agotados); el modal decide qué mostrar
        window._printProducts = json.filter(function(p) { return p.estado === 'DISPONIBLE' || p.estado === 'AGOTADO'; });
        if (!window._printProducts.length) { alert('No hay productos para imprimir.'); return; }
        openPrintConfigModal();
    } catch(e) {
        alert('Error al cargar los productos: ' + e.message);
    }
}

function openPrintConfigModal() {
    var prods = window._printProducts || [];
    // Armar lista de categorías únicas ordenadas por cat_orden
    var catMap = {};
    prods.forEach(function(p) {
        var c = p.categoria || 'SIN CATEGORÍA';
        if (!catMap[c]) catMap[c] = p.cat_orden != null ? Number(p.cat_orden) : 999;
    });
    var cats = Object.keys(catMap).sort(function(a, b) {
        return catMap[a] - catMap[b] || a.localeCompare(b);
    });
    var list = document.getElementById('pCatList');
    list.innerHTML = '';
    cats.forEach(function(cat) {
        var div = document.createElement('div');
        div.className = 'pcat-item';
        div.dataset.cat = cat;
        div.innerHTML = '<span class="pcat-name">' + cat + '</span>' +
            '<span class="pcat-btns">' +
            '<button type="button" onclick="movePrintCat(this,-1)" title="Subir">▲</button>' +
            '<button type="button" onclick="movePrintCat(this,1)" title="Bajar">▼</button>' +
            '</span>';
        list.appendChild(div);
    });
    document.getElementById('printConfigModal').classList.add('open');
}

function closePrintConfigModal() {
    document.getElementById('printConfigModal').classList.remove('open');
}

function togglePrintCatOrder(radio) {
    document.getElementById('pCatOrderWrap').style.display =
        (radio.value === 'categoria') ? '' : 'none';
}

function movePrintCat(btn, dir) {
    var item = btn.closest('.pcat-item');
    var list = item.parentNode;
    if (dir === -1 && item.previousElementSibling) {
        list.insertBefore(item, item.previousElementSibling);
    } else if (dir === 1 && item.nextElementSibling) {
        list.insertBefore(item.nextElementSibling, item);
    }
}

function executePrint() {
    var prods = window._printProducts || [];

    // Tamaño de fuente
    var fontSize = parseInt(document.getElementById('pFontSize').value, 10) || 15;

    // Filtrar agotados según toggle
    var showAgotados = document.getElementById('pShowAgotados').checked;
    if (!showAgotados) {
        prods = prods.filter(function(p) { return p.estado === 'DISPONIBLE'; });
    }
    if (!prods.length) { alert('No hay productos para imprimir con los filtros seleccionados.'); return; }

    // Columnas seleccionadas
    var colChecks = document.querySelectorAll('input[name="pCol"]:checked');
    var cols = Array.from(colChecks).map(function(c) { return c.value; });
    if (!cols.length) { alert('Seleccioná al menos una columna.'); return; }

    // Orden de productos
    var sortOrder = document.getElementById('pSortOrder').value;
    var sorted = prods.slice().sort(function(a, b) {
        if (sortOrder === 'descripcion') return (a.descripcion || '').localeCompare(b.descripcion || '');
        if (sortOrder === 'precio_mayorista') return (Number(a.precio_mayorista) || 0) - (Number(b.precio_mayorista) || 0);
        return (a.codigo || '').localeCompare(b.codigo || '');
    });

    // Agrupacion
    var groupBy = document.querySelector('input[name="pGroupBy"]:checked').value;

    // Campos de cliente
    var clientChecks = document.querySelectorAll('input[name="pclientField"]:checked');
    var clientFields = Array.from(clientChecks).map(function(c) {
        return { value: c.value, label: c.dataset.label };
    });

    // Formato moneda
    function fmtP(v) {
        if (v == null || v === '') return '—';
        return '$ ' + Number(v).toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    }

    var fecha = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });

    // Cabecera de tabla segun columnas
    var colDefs = {
        codigo:           { label: 'Código',       style: 'width:64px' },
        descripcion:      { label: 'Descripción',  style: '' },
        precio_mayorista: { label: 'P. Mayorista', style: 'width:90px;text-align:right' },
        pvp:              { label: 'PVP',           style: 'width:80px;text-align:right' },
        cantidad:         { label: 'Cant.',         style: 'width:50px;text-align:center' },
        estado:           { label: 'Estado',        style: 'width:70px;text-align:center' }
    };
    var theadCells = cols.map(function(c) {
        var d = colDefs[c] || { label: c, style: '' };
        return '<th style="' + d.style + '">' + d.label + '</th>';
    }).join('');

    function buildRow(p) {
        return cols.map(function(c) {
            if (c === 'codigo') return '<td>' + (p.codigo || '') + '</td>';
            if (c === 'descripcion') return '<td>' + (p.descripcion || '') + '</td>';
            if (c === 'precio_mayorista') return '<td class="precio">' + fmtP(p.precio_mayorista) + '</td>';
            if (c === 'pvp') return '<td class="precio">' + fmtP(p.pvp) + '</td>';
            if (c === 'cantidad') return '<td class="cant"></td>';
            if (c === 'estado') return '<td style="text-align:center;font-size:9px">' + (p.estado || '') + '</td>';
            return '<td></td>';
        }).join('');
    }

    var html = '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">' +
        '<title>Nota de Pedido Preventa Cindy Mayorista — ' + fecha + '</title>' +
        '<style>' +
        'body{font-family:Arial,sans-serif;font-size:' + fontSize + 'px;color:#000;margin:0;padding:0}' +
        '.page{padding:14mm 12mm;max-width:210mm;margin:0 auto}' +
        '.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px}' +
        '.header h1{font-size:1.4em;font-weight:900;letter-spacing:.5px;color:#000;margin:0}' +
        '.header .fecha{font-size:1em;color:#000;text-align:right}' +
        '.cliente-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;border:1px solid #888;padding:8px 10px;margin-bottom:10px}' +
        '.cliente-grid .campo{display:flex;gap:6px;align-items:baseline;border-bottom:1px dotted #aaa;padding:2px 0}' +
        '.cliente-grid .campo.full{grid-column:1/-1;min-height:2em;align-items:flex-start;padding-top:3px}' +
        '.cliente-grid .campo label{font-size:0.75em;font-weight:700;text-transform:uppercase;color:#000;white-space:nowrap;min-width:70px}' +
        '.cliente-grid .campo span{flex:1}' +
        '.cat-title{font-size:1em;font-weight:900;background:#003399;color:#fff;padding:3px 8px;margin:10px 0 0}' +
        'table{width:100%;border-collapse:collapse;margin-bottom:0}' +
        'thead tr{background:#dde6ff}' +
        'th,td{border:1px solid #aaa;padding:3px 5px;text-align:left;font-size:1em}' +
        'th{font-weight:700;font-size:0.85em;text-transform:uppercase;color:#000}' +
        'td.cant{text-align:center;width:36px}' +
        'td.precio{text-align:right}' +
        'tr:nth-child(even){background:#f4f4f4}' +
        '.footer{margin-top:14px;border-top:1px solid #aaa;padding-top:6px;font-size:0.85em;color:#000;text-align:center}' +
        '@media print{@page{size:A4 portrait;margin:10mm}body{font-size:' + fontSize + 'px}.page{padding:0;max-width:none}}' +
        '</style></head><body><div class="page">' +
        '<div class="header">' +
        '<div><h1>CINDY MAYORISTA</h1><div style="font-size:1em;font-weight:600;color:#000;margin-top:2px">NOTA DE PEDIDO — PREVENTA</div></div>' +
        '<div class="fecha">Fecha: ' + fecha + '<br><span style="font-size:9px;color:#000">Precios al momento de impresión</span></div>' +
        '</div>';

    // Campos del cliente
    if (clientFields.length) {
        html += '<div class="cliente-grid">';
        clientFields.forEach(function(f) {
            var extraClass = (f.value === 'observaciones') ? ' full' : '';
            html += '<div class="campo' + extraClass + '"><label>' + f.label + '</label><span>&nbsp;</span></div>';
        });
        html += '</div>';
    }

    // Productos
    if (groupBy === 'categoria') {
        var catItems = document.querySelectorAll('#pCatList .pcat-item');
        var catOrder = Array.from(catItems).map(function(el) { return el.dataset.cat; });
        catOrder.forEach(function(cat) {
            var catProds = sorted.filter(function(p) { return (p.categoria || 'SIN CATEGORÍA') === cat; });
            if (!catProds.length) return;
            html += '<div class="cat-title">' + cat + '</div>' +
                '<table><thead><tr>' + theadCells + '</tr></thead><tbody>';
            catProds.forEach(function(p) { html += '<tr>' + buildRow(p) + '</tr>'; });
            html += '</tbody></table>';
        });
    } else {
        html += '<table><thead><tr>' + theadCells + '</tr></thead><tbody>';
        sorted.forEach(function(p) { html += '<tr>' + buildRow(p) + '</tr>'; });
        html += '</tbody></table>';
    }

    html += '<div class="footer">Cindy Mayorista — Bags Store SRL — Catálogo de Preventa</div>' +
        '</div></body></html>';

    closePrintConfigModal();
    // Usamos un iframe oculto para evitar que el navegador muestre "about:blank" en el pie de página
    var iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none';
    document.body.appendChild(iframe);
    iframe.contentDocument.open();
    iframe.contentDocument.write(html);
    iframe.contentDocument.close();
    iframe.contentWindow.focus();
    setTimeout(function() {
        iframe.contentWindow.print();
        setTimeout(function() { document.body.removeChild(iframe); }, 2000);
    }, 400);
}
// Al cargar el admin, verificar si hay una importación reciente que se pueda revertir
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
        // html5-qrcode leaves a <video> inside the reader div — limpiarlo
        var r = document.getElementById("scannerReader");
        if (r) r.innerHTML = "";
    }
}

async function checkLastImport() {
    try {
        var res = await fetch(API + "?action=import_last");
        var json = await res.json();
        if (json.ok && json.import_id) {
            var banner = document.getElementById("undoBanner");
            if (!banner) return;
            var d = new Date(json.created_at);
            var hora = d.getHours().toString().padStart(2,"0") + ":" + d.getMinutes().toString().padStart(2,"0");
            var fechaStr = d.toLocaleDateString("es-AR") + " " + hora;
            banner.innerHTML =
                '<span>↩ Hay una importación reversible del ' + fechaStr + ' (' + json.n + ' producto(s)).</span>' +
                '<button onclick="undoLastImport(\'' + json.import_id + '\')">Deshacer</button>' +
                '<button onclick="hideUndoBanner()" style="background:transparent;color:inherit;opacity:.6;margin-left:4px">✕</button>';
            banner.style.display = "flex";
        }
    } catch (e) { /* silencioso */ }
}

// ── Sync con Manager2Max ─────────────────────────────────────────────────────
var syncPreviewDiff = null;

async function loadSyncStatus() {
    try {
        var res = await fetch(API + "?action=manager_sync_log_ultimo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ _user: authUser, _pass: authPass }),
        });
        var json = await res.json();
        if (!json.ok) return;
        var radio = document.querySelector('input[name="syncMode"][value="' + json.modo + '"]');
        if (radio) radio.checked = true;
        var line = document.getElementById("syncStatusLine");
        if (!line) return;
        if (!json.run_id) {
            line.textContent = "Todavía no se corrió ninguna sincronización.";
            return;
        }
        var partes = json.filas.map(function (f) {
            var estado = f.ok == 1 ? "OK" : "FALLÓ" + (f.mensaje ? " (" + f.mensaje + ")" : "");
            var detalle = f.ok == 1 ? " (" + f.actualizados + " act., " + f.nuevos + " nuevos)" : "";
            return f.marca + " " + estado + detalle;
        });
        var d = new Date(json.filas[0].created_at.replace(" ", "T"));
        var fechaStr = d.toLocaleDateString("es-AR") + " " + d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");
        line.innerHTML = "Última sync: " + fechaStr + " — " + partes.join(", ");
    } catch (e) {}
}

async function setSyncMode(modo) {
    var res = await fetch(API + "?action=config_set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _user: authUser, _pass: authPass, clave: "manager_sync_mode", valor: modo }),
    });
    var json = await res.json();
    if (json.ok) toast("Modo de sincronización actualizado");
}

async function sincronizarManagerAhora() {
    var modoSel = document.querySelector('input[name="syncMode"]:checked');
    modoSel = modoSel ? modoSel.value : "manual";
    var btn = document.getElementById("btnSyncNow");
    btn.disabled = true;
    btn.textContent = "Consultando Manager...";
    try {
        if (modoSel === "manual") {
            var res = await fetch(API + "?action=manager_sync_preview", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ _user: authUser, _pass: authPass }),
            });
            var json = await res.json();
            if (!json.ok) { toast("Error: " + json.error, "#c62828"); return; }
            renderSyncPreview(json);
            document.getElementById("syncPreviewModal").classList.add("open");
        } else {
            var res2 = await fetch(API + "?action=manager_sync_apply", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ _user: authUser, _pass: authPass }),
            });
            var json2 = await res2.json();
            if (!json2.ok) { toast("Error: " + json2.error, "#c62828"); return; }
            toast(
                "Sync aplicada: " + json2.actualizados + " actualizados, " + json2.nuevos_creados + " nuevos" +
                (json2.nuevos_pendientes ? ", " + json2.nuevos_pendientes + " pendientes de aprobar" : "")
            );
            loadSyncStatus();
            loadPendientesManagerBadge();
            await loadProducts();
        }
    } catch (e) {
        toast("Error de conexión con Manager", "#c62828");
    } finally {
        btn.disabled = false;
        btn.textContent = "🔄 Sincronizar ahora";
    }
}

var _syncFilter = "todos";

function renderSyncPreview(diff) {
    syncPreviewDiff = diff;
    _syncFilter = "todos";
    var wrap = document.getElementById("syncPreviewWrap");
    wrap.innerHTML = buildSyncPreviewHTML(diff);
    var importable = diff.actualiza.length + diff.nuevos.length;
    var btn = document.getElementById("btnSyncConfirm");
    if (btn) btn.disabled = importable === 0;
}

function buildSyncPreviewHTML(diff) {
    var counts = {
        NUEVO: diff.nuevos.length,
        ACTUALIZA: diff.actualiza.length,
        SIN_CAMBIOS: diff.sin_cambios.length,
    };
    var all = diff.nuevos
        .map(function (it) { return { it: it, status: "NUEVO" }; })
        .concat(diff.actualiza.map(function (it) { return { it: it, status: "ACTUALIZA" }; }))
        .concat(diff.sin_cambios.map(function (it) { return { it: it, status: "SIN_CAMBIOS" }; }));
    var visible = _syncFilter === "todos" ? all : all.filter(function (r) { return r.status === _syncFilter; });

    var html = "";

    // ── Estado por marca (si alguna falló, se ve acá arriba de todo) ──
    var partesMarca = Object.keys(diff.por_marca).map(function (m) {
        var r = diff.por_marca[m];
        return r.ok ? m + ": " + r.cantidad + " artículos" : m + ": ⚠ FALLÓ (" + r.mensaje + ")";
    });
    html += "<div style='font-size:12px;color:#888;margin-bottom:12px'>" + partesMarca.join(" · ") + "</div>";

    // ── Stat tiles ──
    html += "<div style='display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px'>";
    html += importStatTile("✅ Nuevos", counts.NUEVO, "#1b5e20", "#e8f5e9");
    html += importStatTile("🔄 Actualizan", counts.ACTUALIZA, "#0d47a1", "#e3f2fd");
    html += importStatTile("⏭ Sin cambios", counts.SIN_CAMBIOS, "#555", "#f5f5f5");
    html += "</div>";

    // ── Filter tabs ──
    html += "<div style='display:flex;gap:5px;margin-bottom:10px;flex-wrap:wrap'>";
    html += syncFilterTab("todos", "Todos", all.length);
    html += syncFilterTab("NUEVO", "Nuevos", counts.NUEVO);
    html += syncFilterTab("ACTUALIZA", "Actualizan", counts.ACTUALIZA);
    html += syncFilterTab("SIN_CAMBIOS", "Sin cambios", counts.SIN_CAMBIOS);
    html += "</div>";

    // ── Tabla con sticky header ──
    var STATUS_BG = { NUEVO: "#e8f5e9", ACTUALIZA: "#e3f2fd", SIN_CAMBIOS: "#fafafa" };
    var STATUS_BADGE = {
        NUEVO: { bg: "#c8e6c9", color: "#1b5e20", label: "NUEVO" },
        ACTUALIZA: { bg: "#bbdefb", color: "#0d47a1", label: "ACTUALIZA" },
        SIN_CAMBIOS: { bg: "#eeeeee", color: "#757575", label: "SIN CAMBIOS" },
    };
    var CAMPOS = [
        { key: "descripcion", label: "Descripción" },
        { key: "categoria", label: "Categoría" },
        { key: "precio_mayorista", label: "Mayorista", money: true },
        { key: "pvp", label: "PVP", money: true },
        { key: "estado", label: "Estado" },
    ];

    html += "<div style='overflow:auto;max-height:320px;border:1px solid #e0e0e0;border-radius:8px'>";
    html += "<table class='import-preview-table' style='min-width:100%'><thead><tr>";
    html += "<th style='min-width:90px'>Cambio</th><th>Código</th><th>Marca</th>";
    CAMPOS.forEach(function (c) { html += "<th>" + c.label + "</th>"; });
    html += "</tr></thead><tbody>";

    if (!visible.length) {
        html += "<tr><td colspan='" + (CAMPOS.length + 3) + "' style='text-align:center;padding:20px;color:#999'>Sin filas en este filtro</td></tr>";
    }

    visible.slice(0, 100).forEach(function (f) {
        var it = f.it;
        var badge = STATUS_BADGE[f.status];
        html += "<tr style='background:" + STATUS_BG[f.status] + "'>";
        html += "<td style='padding:6px 8px'><span class='imp-badge' style='background:" + badge.bg + ";color:" + badge.color + "'>" + badge.label + "</span></td>";
        html += "<td style='padding:6px 8px'>" + esc(it.codigo) + "</td>";
        html += "<td style='padding:6px 8px'>" + esc(it.marca_manager) + "</td>";
        CAMPOS.forEach(function (c) {
            var val = it[c.key];
            var display = c.money ? "$" + Math.round(val || 0) : esc(String(val ?? ""));
            if (f.status === "ACTUALIZA" && it._anterior) {
                var oldVal = it._anterior[c.key];
                var changed = c.money ? Math.round(parseFloat(oldVal) * 100) !== Math.round(parseFloat(val) * 100) : String(oldVal) !== String(val);
                if (changed) {
                    var oldDisplay = c.money ? "$" + Math.round(oldVal || 0) : esc(String(oldVal ?? ""));
                    html += "<td style='padding:6px 8px;font-size:12px'><span style='text-decoration:line-through;color:#aaa'>" + oldDisplay + "</span> → <strong>" + display + "</strong></td>";
                    return;
                }
            }
            html += "<td style='padding:6px 8px'>" + display + "</td>";
        });
        html += "</tr>";
    });

    if (visible.length > 100) {
        html += "<tr><td colspan='" + (CAMPOS.length + 3) + "' style='text-align:center;padding:10px;color:#999;font-size:12px'>… y " + (visible.length - 100) + " filas más</td></tr>";
    }

    html += "</tbody></table></div>";

    if (counts.SIN_CAMBIOS > 0) {
        html += "<p style='font-size:12px;color:#888;margin-top:8px'>⏭ Las " + counts.SIN_CAMBIOS + " fila(s) sin cambios no se van a tocar.</p>";
    }

    return html;
}

function syncFilterTab(value, label, count) {
    var isActive = _syncFilter === value;
    var cls = "imp-tab" + (isActive ? " active" : "");
    return "<button class='" + cls + "' onclick='setSyncFilter(\"" + value + "\")'>" + label + " (" + count + ")</button>";
}

function setSyncFilter(value) {
    _syncFilter = value;
    if (syncPreviewDiff) document.getElementById("syncPreviewWrap").innerHTML = buildSyncPreviewHTML(syncPreviewDiff);
}

function closeSyncPreviewModal() {
    document.getElementById("syncPreviewModal").classList.remove("open");
    syncPreviewDiff = null;
}

async function confirmarSyncManager() {
    var btn = document.getElementById("btnSyncConfirm");
    btn.disabled = true;
    btn.textContent = "Aplicando...";
    try {
        var res = await fetch(API + "?action=manager_sync_apply", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ _user: authUser, _pass: authPass }),
        });
        var json = await res.json();
        if (!json.ok) { toast("Error: " + json.error, "#c62828"); return; }
        toast("Sync aplicada: " + json.actualizados + " actualizados, " + json.nuevos_creados + " nuevos");
        closeSyncPreviewModal();
        loadSyncStatus();
        loadPendientesManagerBadge();
        await loadProducts();
    } catch (e) {
        toast("Error al aplicar la sync", "#c62828");
    } finally {
        btn.disabled = false;
        btn.textContent = "Confirmar y aplicar";
    }
}

// ── Pendientes de Manager (modo semiautomático) ─────────────────────────────
async function loadPendientesManagerBadge() {
    try {
        var res = await fetch(API + "?action=manager_sync_pendientes_list", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ _user: authUser, _pass: authPass }),
        });
        var json = await res.json();
        var n = Array.isArray(json) ? json.length : 0;
        var badge = document.getElementById("pendMgrBadge");
        if (badge) {
            badge.textContent = n;
            badge.style.display = n > 0 ? "" : "none";
        }
    } catch (e) {}
}

async function loadPendientesManager() {
    var res = await fetch(API + "?action=manager_sync_pendientes_list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _user: authUser, _pass: authPass }),
    });
    var rows = await res.json();
    var tbody = document.getElementById("pendMgrTbody");
    if (!Array.isArray(rows) || !rows.length) {
        tbody.innerHTML = "<tr><td colspan='9' style='text-align:center;color:#888'>No hay productos pendientes de aprobación</td></tr>";
        var badge = document.getElementById("pendMgrBadge");
        if (badge) badge.style.display = "none";
        return;
    }
    tbody.innerHTML = rows
        .map(function (p) {
            return (
                "<tr>" +
                "<td><input type='checkbox' class='pendChk' value='" + p.id + "'></td>" +
                "<td>" + esc(p.codigo) + "</td><td>" + esc(p.descripcion) + "</td><td>" + esc(p.categoria) + "</td>" +
                "<td>$" + Math.round(p.precio_mayorista) + "</td><td>$" + Math.round(p.pvp || 0) + "</td><td>" + p.estado + "</td>" +
                "<td>" + esc(p.marca_manager) + "</td>" +
                "<td><button class='btn btn-primary' style='padding:4px 10px;font-size:11px' onclick='aprobarPendiente(" + p.id + ")'>✓ Aprobar</button> " +
                "<button class='btn' style='padding:4px 10px;font-size:11px;color:#c62828' onclick='rechazarPendiente(" + p.id + ")'>✗ Rechazar</button></td>" +
                "</tr>"
            );
        })
        .join("");
    var selAll = document.getElementById("pendSelectAll");
    if (selAll) selAll.checked = false;
}

function toggleSelectAllPendientes(cb) {
    document.querySelectorAll(".pendChk").forEach(function (el) { el.checked = cb.checked; });
}

function pendientesSeleccionados() {
    return Array.from(document.querySelectorAll(".pendChk:checked")).map(function (el) { return parseInt(el.value); });
}

async function aprobarPendiente(id) { await aplicarAccionPendientes([id], "aprobar"); }
async function rechazarPendiente(id) { await aplicarAccionPendientes([id], "rechazar"); }

async function aprobarPendientesSeleccionados() {
    var ids = pendientesSeleccionados();
    if (!ids.length) { toast("Seleccioná al menos un producto", "#c62828"); return; }
    await aplicarAccionPendientes(ids, "aprobar");
}
async function rechazarPendientesSeleccionados() {
    var ids = pendientesSeleccionados();
    if (!ids.length) { toast("Seleccioná al menos un producto", "#c62828"); return; }
    await aplicarAccionPendientes(ids, "rechazar");
}

async function aplicarAccionPendientes(ids, accion) {
    var action = accion === "aprobar" ? "manager_sync_pendientes_aprobar" : "manager_sync_pendientes_rechazar";
    var res = await fetch(API + "?action=" + action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _user: authUser, _pass: authPass, ids: ids }),
    });
    var json = await res.json();
    if (json.ok) {
        toast(
            accion === "aprobar"
                ? (json.creados || ids.length) + " producto(s) aprobado(s)"
                : (json.eliminados || ids.length) + " producto(s) rechazado(s)"
        );
        loadPendientesManager();
        loadPendientesManagerBadge();
        if (accion === "aprobar") await loadProducts();
    } else {
        toast("Error: " + json.error, "#c62828");
    }
}

// ── Image bulk import ─────────────────────────────────────────────────────────
var imgFilesToUpload = [];   // Array de {file, codigo, isZip, matchStatus}

function openImgImportModal() {
    imgFilesToUpload = [];
    var modal = document.getElementById("imgImportModal");
    if (!modal) return;
    modal.classList.add("open");
    document.getElementById("imgPreviewWrap").innerHTML = "";
    document.getElementById("imgFileInput").value = "";
    document.getElementById("btnImgUpload").style.display = "none";
    var zone = document.getElementById("imgDropZone");
    if (zone) zone.classList.remove("dragover");
}

function closeImgImportModal() {
    var modal = document.getElementById("imgImportModal");
    if (modal) modal.classList.remove("open");
    imgFilesToUpload = [];
}

function imgDragOver(event) {
    event.preventDefault();
    document.getElementById("imgDropZone").classList.add("dragover");
}

function imgDragLeave(event) {
    document.getElementById("imgDropZone").classList.remove("dragover");
}

function imgDrop(event) {
    event.preventDefault();
    document.getElementById("imgDropZone").classList.remove("dragover");
    var files = event.dataTransfer.files;
    if (files && files.length > 0) imgFilesSelected(files);
}

async function imgFilesSelected(files) {
    if (!files || !files.length) return;
    document.getElementById("imgPreviewWrap").innerHTML =
        '<p style="color:#888;padding:16px 0">Analizando archivos…</p>';
    document.getElementById("btnImgUpload").style.display = "none";

    // Separar ZIP de imágenes individuales
    var zipFiles = [], imgFiles = [];
    Array.from(files).forEach(function(f) {
        var ext = f.name.split(".").pop().toLowerCase();
        if (ext === "zip") { zipFiles.push(f); }
        else if (["jpg","jpeg","png","webp"].indexOf(ext) !== -1) { imgFiles.push(f); }
    });

    imgFilesToUpload = [];
    var codigos = [];

    // Para imágenes individuales: extraer CODIGO del nombre y verificar en BD
    imgFiles.forEach(function(f) {
        var codigo = f.name.replace(/\.[^.]+$/, "");  // nombre sin extensión
        codigos.push(codigo);
        imgFilesToUpload.push({ file: f, codigo: codigo, isZip: false, matchStatus: "checking" });
    });

    // ZIPs: no podemos leer contenido client-side sin lib extra, mostramos como pendiente
    zipFiles.forEach(function(f) {
        imgFilesToUpload.push({ file: f, codigo: null, isZip: true, matchStatus: "zip" });
    });

    // Verificar CODIGOs de imágenes individuales contra la BD
    if (codigos.length > 0) {
        try {
            var resp = await fetch(API, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "check_codigos", _user: authUser, _pass: authPass, codigos: codigos })
            });
            var json = await resp.json();
            var found = json.produtos || json.productos || {};
            imgFilesToUpload.forEach(function(item) {
                if (item.isZip) return;
                item.matchStatus = found[item.codigo] ? "found" : "not_found";
                item.productData = found[item.codigo] || null;
            });
        } catch(e) {
            imgFilesToUpload.forEach(function(item) {
                if (!item.isZip) item.matchStatus = "error";
            });
        }
    }

    renderImgPreview();
}

function renderImgPreview() {
    var wrap = document.getElementById("imgPreviewWrap");
    if (!imgFilesToUpload.length) { wrap.innerHTML = ""; return; }

    var found    = imgFilesToUpload.filter(function(i) { return i.matchStatus === "found"; }).length;
    var notFound = imgFilesToUpload.filter(function(i) { return i.matchStatus === "not_found"; }).length;
    var zips     = imgFilesToUpload.filter(function(i) { return i.isZip; }).length;
    var total    = imgFilesToUpload.length;

    // Stat tiles
    var html = '<div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap">';
    html += imgStatTile(total,    "Total",         "#1565c0","#e3f2fd");
    if (zips)     html += imgStatTile(zips,     "ZIP",           "#6a1b9a","#f3e5f5");
    if (found)    html += imgStatTile(found,    "Producto OK",   "#2e7d32","#e8f5e9");
    if (notFound) html += imgStatTile(notFound, "No encontrado", "#c62828","#ffebee");
    html += '</div>';

    // Tabla de imágenes individuales
    var imgItems = imgFilesToUpload.filter(function(i) { return !i.isZip; });
    var zipItems = imgFilesToUpload.filter(function(i) { return i.isZip; });

    if (zipItems.length) {
        html += '<div style="margin-bottom:14px">';
        html += '<div style="font-weight:600;margin-bottom:8px;color:#555">📦 Archivos ZIP</div>';
        zipItems.forEach(function(item) {
            var mb = (item.file.size / 1024 / 1024).toFixed(2);
            html += '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;' +
                'background:#f3e5f5;border-radius:8px;margin-bottom:6px">' +
                '<span style="font-size:1.4rem">📦</span>' +
                '<div><div style="font-weight:600">' + escHtml(item.file.name) + '</div>' +
                '<div style="font-size:.8rem;color:#888">' + mb + ' MB — el servidor procesará las imágenes según el nombre de archivo</div></div>' +
                '</div>';
        });
        html += '</div>';
    }

    if (imgItems.length) {
        html += '<div style="font-weight:600;margin-bottom:8px;color:#555">🖼 Imágenes individuales</div>';
        html += '<div id="imgThumbGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px">';
        imgItems.forEach(function(item, idx) {
            var statusColor = item.matchStatus === "found"     ? "#2e7d32" :
                              item.matchStatus === "not_found" ? "#c62828" : "#f57c00";
            var statusBg    = item.matchStatus === "found"     ? "#e8f5e9" :
                              item.matchStatus === "not_found" ? "#ffebee" : "#fff3e0";
            var statusLabel = item.matchStatus === "found"     ? "✔ OK" :
                              item.matchStatus === "not_found" ? "✗ No encontrado" : "⚠ Error";
            html += '<div id="imgCard_' + idx + '" style="border:1px solid #e0e0e0;border-radius:10px;' +
                'overflow:hidden;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.07)">' +
                '<div style="height:120px;background:#f5f5f5;display:flex;align-items:center;justify-content:center">' +
                '<img id="imgThumb_' + idx + '" src="" alt="" ' +
                'style="max-width:100%;max-height:120px;object-fit:contain;display:none">' +
                '<span id="imgThumbIcon_' + idx + '" style="font-size:2rem">🖼</span>' +
                '</div>' +
                '<div style="padding:8px 10px">' +
                '<div style="font-size:.78rem;font-weight:600;color:#333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + escHtml(item.file.name) + '">' +
                escHtml(item.codigo) + '</div>' +
                '<div style="display:inline-block;font-size:.7rem;padding:2px 8px;border-radius:99px;' +
                'background:' + statusBg + ';color:' + statusColor + ';margin-top:4px;font-weight:600">' +
                statusLabel + '</div>' +
                '</div></div>';
        });
        html += '</div>';
    }

    wrap.innerHTML = html;

    // Cargar thumbnails con FileReader (async, uno por uno)
    imgItems.forEach(function(item, idx) {
        var reader = new FileReader();
        reader.onload = function(e) {
            var thumb = document.getElementById("imgThumb_" + idx);
            var icon  = document.getElementById("imgThumbIcon_" + idx);
            if (thumb) { thumb.src = e.target.result; thumb.style.display = "block"; }
            if (icon)  { icon.style.display = "none"; }
        };
        reader.readAsDataURL(item.file);
    });

    // Mostrar botón de subida solo si hay algo que subir
    var uploadable = imgFilesToUpload.filter(function(i) {
        return i.isZip || i.matchStatus === "found";
    }).length;
    var btn = document.getElementById("btnImgUpload");
    if (uploadable > 0) {
        btn.style.display = "";
        btn.disabled = false;
        btn.textContent = "Subir " + uploadable + " imagen" + (uploadable !== 1 ? "s" : "");
    } else {
        btn.style.display = "none";
        btn.disabled = true;
    }
}

function imgStatTile(n, label, color, bg) {
    return '<div style="flex:1;min-width:90px;background:' + bg + ';border-radius:10px;' +
        'padding:12px 16px;text-align:center">' +
        '<div style="font-size:1.5rem;font-weight:700;color:' + color + '">' + n + '</div>' +
        '<div style="font-size:.75rem;color:#555;margin-top:2px">' + label + '</div>' +
        '</div>';
}

async function uploadImages() {
    var btn = document.getElementById("btnImgUpload");
    btn.disabled = true;
    btn.textContent = "Subiendo…";

    var BULK_URL = "../upload_bulk.php";
    var allResults = [];

    // Separar ZIPs e imágenes individuales
    var zipItems = imgFilesToUpload.filter(function(i) { return i.isZip; });
    var imgItems = imgFilesToUpload.filter(function(i) { return !i.isZip && i.matchStatus === "found"; });

    // Subir imágenes individuales en un solo POST (multi-file)
    if (imgItems.length > 0) {
        var fd = new FormData();
        fd.append("_user", authUser);
        fd.append("_pass", authPass);
        imgItems.forEach(function(item) {
            fd.append("images[]", item.file, item.file.name);
        });
        try {
            var resp = await fetch(BULK_URL, { method: "POST", body: fd });
            var json = await resp.json();
            if (json.ok && json.results) allResults = allResults.concat(json.results);
        } catch(e) {
            allResults.push({ status: "error", msg: "Error de red al subir imágenes" });
        }
    }

    // Subir cada ZIP por separado
    for (var i = 0; i < zipItems.length; i++) {
        var zitem = zipItems[i];
        var fdz = new FormData();
        fdz.append("_user", authUser);
        fdz.append("_pass", authPass);
        fdz.append("zipfile", zitem.file, zitem.file.name);
        try {
            var respZ = await fetch(BULK_URL, { method: "POST", body: fdz });
            var jsonZ = await respZ.json();
            if (jsonZ.ok && jsonZ.results) allResults = allResults.concat(jsonZ.results);
        } catch(e) {
            allResults.push({ codigo: zitem.file.name, status: "error", msg: "Error de red" });
        }
    }

    // Mostrar resultados
    var updated   = allResults.filter(function(r) { return r.status === "updated"; }).length;
    var notFound  = allResults.filter(function(r) { return r.status === "not_found"; }).length;
    var errors    = allResults.filter(function(r) { return r.status === "error"; }).length;

    var resHtml = '<div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap">';
    resHtml += imgStatTile(updated,  "Actualizadas", "#2e7d32","#e8f5e9");
    if (notFound) resHtml += imgStatTile(notFound, "No encontrado", "#c62828","#ffebee");
    if (errors)   resHtml += imgStatTile(errors,   "Errores",       "#e65100","#fff3e0");
    resHtml += '</div>';

    if (allResults.length > 0) {
        resHtml += '<table style="width:100%;border-collapse:collapse;font-size:.85rem">' +
            '<thead><tr style="background:#f5f5f5">' +
            '<th style="text-align:left;padding:6px 10px">Código</th>' +
            '<th style="text-align:left;padding:6px 10px">Estado</th>' +
            '<th style="text-align:left;padding:6px 10px">Detalle</th>' +
            '</tr></thead><tbody>';
        allResults.forEach(function(r) {
            var statusColor = r.status === "updated"   ? "#2e7d32" :
                              r.status === "not_found" ? "#c62828" : "#e65100";
            var statusLabel = r.status === "updated"   ? "✔ Actualizada" :
                              r.status === "not_found" ? "✗ No encontrado" : "⚠ Error";
            resHtml += '<tr style="border-bottom:1px solid #f0f0f0">' +
                '<td style="padding:6px 10px;font-weight:600">' + escHtml(r.codigo || "-") + '</td>' +
                '<td style="padding:6px 10px;color:' + statusColor + ';font-weight:600">' + statusLabel + '</td>' +
                '<td style="padding:6px 10px;color:#666">' + escHtml(r.filename || r.msg || "") + '</td>' +
                '</tr>';
        });
        resHtml += '</tbody></table>';
    }

    document.getElementById("imgPreviewWrap").innerHTML = resHtml;
    btn.disabled = false;
    btn.style.display = "none";

    // Recargar productos para que las imágenes nuevas se vean en la tabla
    if (updated > 0) loadProducts();
}

function escHtml(s) {
    if (!s) return "";
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ── Buscador de herramientas / configuración ─────────────────────
function filterTools(inputEl, gridId) {
    var q = inputEl.value.toLowerCase().trim();
    var grid = document.getElementById(gridId);
    if (!grid) return;
    Array.from(grid.querySelectorAll(".config-box")).forEach(function(box) {
        var text = (box.querySelector("h3") ? box.querySelector("h3").textContent : "") +
                   " " + (box.dataset.keywords || "");
        var match = !q || text.toLowerCase().indexOf(q) !== -1;
        box.classList.toggle("tools-hidden", !match);
    });
}
