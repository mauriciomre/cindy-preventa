<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/helpers.php';

define('ADMIN_USER', 'admin');
define('ADMIN_PASS', 'preventa2026');

// Igual que checkAuth, pero sin cortar la ejecución si las credenciales no
// vienen o son inválidas — para endpoints públicos que se comportan distinto
// según si quien pregunta es el admin o un cliente (ver acción "productos").
function isAdminAuth($u, $p) {
    global $db;
    $r = $db->query("SELECT valor FROM config WHERE clave='admin_pass' LIMIT 1");
    $row = $r ? $r->fetch_assoc() : null;
    $validPass = $row ? $row['valor'] : ADMIN_PASS;
    return $u === ADMIN_USER && $p !== '' && hash_equals($validPass, (string)$p);
}

function checkAuth($data) {
    $u = $data['_user'] ?? '';
    $p = $data['_pass'] ?? '';
    if (!isAdminAuth($u, $p)) {
        http_response_code(401);
        die(json_encode(['error' => 'No autorizado']));
    }
}

// ── Búsqueda en Manager2Max (solo lectura) ───────────────────────────────────
// Fase 2: prellenar código/descripción/categoría/precios al dar de alta un
// producto de preventa. IDEmpresa=4 (TEST/sandbox) a propósito — decisión de
// Mauricio (28/08/2026): siempre 4 para esto, nunca producción, sin excepción
// (es de solo lectura así que no hay riesgo de escribir, pero al ser una copia
// de la base real que no se autoactualiza, los datos pueden estar desfasados
// respecto al Manager de producción — igual sirve para no tipear a mano).
define('MANAGER_LISTA_MAYORISTA', 2); // "Mayorista" (real de Cindy, no la de Travel Blue)

function manager_login() {
    $ch = curl_init(MANAGER_API_URL . '/Api/Login/LoginUsuarioEmpresa');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json; charset=utf-8']);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
        'CodigoUsuario' => MANAGER_API_USER,
        'Contraseña' => MANAGER_API_PASS,
        'IDEmpresa' => MANAGER_IDEMPRESA,
    ], JSON_UNESCAPED_UNICODE));
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
    curl_setopt($ch, CURLOPT_TIMEOUT, 20);
    $resp = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);
    if ($err) throw new Exception("Login Manager falló: $err");
    $data = json_decode($resp, true);
    if (empty($data['Token'])) throw new Exception("Login Manager sin token: " . ($data['ErrMessage'] ?? 'desconocido'));
    return $data['Token'];
}

function manager_call($token, $endpoint, $body) {
    $ch = curl_init(MANAGER_API_URL . $endpoint);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json; charset=utf-8', 'Authorization: Bearer ' . $token]);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    $resp = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);
    if ($err) throw new Exception("Manager $endpoint falló: $err");
    $data = json_decode($resp, true);
    if (($data['ErrCode'] ?? null) !== 200) throw new Exception("Manager $endpoint error: " . ($data['ErrMessage'] ?? 'desconocido'));
    return $data['Data']['DT']['data'] ?? [];
}

function manager_filtro_texto($valor, $criteria = 0) {
    return [
        '$type' => 'UpSoft.Framework.Data.Filters.FilterText, UpSoft.Framework.Data',
        'Criteria' => $criteria,
        'Value' => $valor,
        'ArrayValue' => ['$type' => 'System.Collections.Generic.List`1[[System.String, mscorlib]], mscorlib', '$values' => ['']],
        'FieldName' => '',
        'ActiveFilter' => true,
    ];
}
function manager_filtro_numero($valor) {
    return [
        '$type' => 'UpSoft.Framework.Data.Filters.FilterNumber, UpSoft.Framework.Data',
        'Criteria' => 0, 'Value1' => $valor, 'Value2' => 0.0, 'FieldName' => '', 'ActiveFilter' => true,
    ];
}
function manager_dict_filtros($filtros) {
    return array_merge([
        '$type' => 'System.Collections.Generic.Dictionary`2[[System.String, mscorlib],[UpSoft.Framework.Data.Filters.BaseFilter, UpSoft.Framework.Data]], mscorlib',
    ], $filtros);
}

// Busca un artículo por código exacto en Manager (Contains del lado del
// servidor, se filtra por igualdad exacta acá porque ese filtro no es
// confiable como exact-match — ver Mi-Cerebro/conocimiento/manager2max.md).
function manager_buscar_por_codigo($token, $codigo) {
    $articulos = manager_call($token, '/Api/articulo/GetDTArticulos', [
        'DTRequest' => ['draw' => 1, 'order' => [], 'start' => 0, 'length' => 20],
        'DefinicionTablaFiltros' => false,
        'CalculaTotales' => false,
        'ListFilters' => manager_dict_filtros(['CodigoArticulo' => manager_filtro_texto($codigo)]),
    ]);
    foreach ($articulos as $a) {
        if (trim($a['CodigoArticulo'] ?? '') === $codigo) return $a;
    }
    return null;
}

function manager_precio_por_codigo($token, $codigo, $idLista) {
    $precios = manager_call($token, '/Api/articulo/GetDTArticulosPrecioExistencia', [
        'DTRequest' => ['draw' => 1, 'order' => [], 'start' => 0, 'length' => 20],
        'DefinicionTablaFiltros' => false,
        'CalculaTotales' => false,
        'ListFilters' => manager_dict_filtros([
            'IDListaPrecio' => manager_filtro_numero($idLista),
            'IDDeposito' => manager_filtro_numero(0),
            'IDCliente' => manager_filtro_numero(0),
            'IDProveedor' => manager_filtro_numero(0),
            'IDMonedaComprobante' => manager_filtro_numero(1),
            'FactorCotizacionMonCompMonLP' => manager_filtro_numero(1.0),
            'ArticuloCompleto' => manager_filtro_texto($codigo, 1),
        ]),
    ]);
    foreach ($precios as $p) {
        if (trim($p['CodigoArticulo'] ?? '') === $codigo && isset($p['PrecioFinalLP'])) {
            return round(floatval($p['PrecioFinalLP']), 2);
        }
    }
    return null;
}

function setupDB($db) {
    $db->query("CREATE TABLE IF NOT EXISTS categorias (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL UNIQUE,
        orden INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Rubros oficiales de Cindy Mayorista (Mi-Cerebro/conocimiento/cindy-mayorista-operativa.md)
    $rubros = ['Carteras', 'Bebé', 'Mochilas', 'Equipajes', 'Billeteras', 'Librería', 'Paraguas', 'Accesorios', 'Deco', 'Juguetería'];
    foreach ($rubros as $i => $nombre) {
        $stmt = $db->prepare("INSERT IGNORE INTO categorias (nombre, orden) VALUES (?, ?)");
        $nombreUp = mb_strtoupper($nombre, 'UTF-8');
        $stmt->bind_param('si', $nombreUp, $i);
        $stmt->execute();
    }

    $db->query("CREATE TABLE IF NOT EXISTS productos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        codigo VARCHAR(50) NOT NULL UNIQUE,
        descripcion VARCHAR(255) NOT NULL,
        categoria VARCHAR(100) NOT NULL,
        precio_mayorista DECIMAL(12,2) NOT NULL DEFAULT 0,
        pvp DECIMAL(12,2) DEFAULT NULL,
        foto VARCHAR(500) DEFAULT NULL,
        estado ENUM('DISPONIBLE','AGOTADO') NOT NULL DEFAULT 'DISPONIBLE',
        orden INT DEFAULT 0,
        multiplo INT DEFAULT 1,
        stock_preventa INT NOT NULL DEFAULT 0,
        stock_preventa_inicial INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $colCheck = $db->query("SHOW COLUMNS FROM productos LIKE 'multiplo'");
    if ($colCheck && $colCheck->num_rows === 0) {
        $db->query("ALTER TABLE productos ADD COLUMN multiplo INT DEFAULT 1");
    }

    $colCheck = $db->query("SHOW COLUMNS FROM productos LIKE 'codigo_barras'");
    if ($colCheck && $colCheck->num_rows === 0) {
        $db->query("ALTER TABLE productos ADD COLUMN codigo_barras VARCHAR(50) DEFAULT NULL");
        $db->query("ALTER TABLE productos ADD INDEX idx_codigo_barras (codigo_barras)");
    }

    // Control de stock de preventa: no viene de Manager, se carga a mano acá
    // para no sobrevender mercadería que todavía no llegó físicamente.
    $colCheck = $db->query("SHOW COLUMNS FROM productos LIKE 'stock_preventa'");
    if ($colCheck && $colCheck->num_rows === 0) {
        $db->query("ALTER TABLE productos ADD COLUMN stock_preventa INT NOT NULL DEFAULT 0");
    }
    $colCheck = $db->query("SHOW COLUMNS FROM productos LIKE 'stock_preventa_inicial'");
    if ($colCheck && $colCheck->num_rows === 0) {
        $db->query("ALTER TABLE productos ADD COLUMN stock_preventa_inicial INT NOT NULL DEFAULT 0");
    }

    // Preventas: campañas puntuales que agrupan productos (ej. "PREVENTA DÍA
    // DEL NIÑO"). Sin fechas de vigencia a propósito — el alta/baja es manual
    // (columna "activa"), decisión explícita de Mauricio. Un producto
    // pertenece a UNA sola preventa (no es muchos-a-muchos) y solo se muestra
    // en el catálogo público si tiene preventa asignada Y esa preventa está
    // activa — ver el filtro en la acción "productos" más abajo.
    $db->query("CREATE TABLE IF NOT EXISTS preventas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL UNIQUE,
        detalle VARCHAR(300) DEFAULT NULL,
        imagen VARCHAR(500) DEFAULT NULL,
        activa TINYINT NOT NULL DEFAULT 0,
        orden INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $colCheck = $db->query("SHOW COLUMNS FROM preventas LIKE 'detalle'");
    if ($colCheck && $colCheck->num_rows === 0) {
        $db->query("ALTER TABLE preventas ADD COLUMN detalle VARCHAR(300) DEFAULT NULL");
    }

    $colCheck = $db->query("SHOW COLUMNS FROM productos LIKE 'preventa_id'");
    if ($colCheck && $colCheck->num_rows === 0) {
        $db->query("ALTER TABLE productos ADD COLUMN preventa_id INT DEFAULT NULL");
        $db->query("ALTER TABLE productos ADD INDEX idx_preventa_id (preventa_id)");
    }

    $db->query("CREATE TABLE IF NOT EXISTS import_snapshots (
        id INT AUTO_INCREMENT PRIMARY KEY,
        import_id VARCHAR(50) NOT NULL,
        codigo VARCHAR(50) NOT NULL,
        accion ENUM('updated','inserted') NOT NULL,
        datos_anteriores TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_import_id (import_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $db->query("CREATE TABLE IF NOT EXISTS config (
        clave VARCHAR(50) PRIMARY KEY,
        valor VARCHAR(255) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $db->query("CREATE TABLE IF NOT EXISTS colores (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL UNIQUE,
        hex VARCHAR(7) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $db->query("CREATE TABLE IF NOT EXISTS producto_colores (
        producto_id INT NOT NULL,
        color_id INT NOT NULL,
        PRIMARY KEY (producto_id, color_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // WhatsApp oficial de Cindy Mayorista (Mi-Cerebro/conocimiento/aportes/mariela.md)
    $db->query("INSERT IGNORE INTO config (clave, valor) VALUES ('whatsapp', '5493534140385')");

    $db->query("CREATE TABLE IF NOT EXISTS transportes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL UNIQUE,
        orden INT DEFAULT 0,
        activo TINYINT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $db->query("CREATE TABLE IF NOT EXISTS clientes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        telefono VARCHAR(20) NOT NULL UNIQUE,
        nombre VARCHAR(255) NOT NULL,
        cuit_dni VARCHAR(20) DEFAULT NULL,
        email VARCHAR(255) DEFAULT NULL,
        domicilio VARCHAR(255) DEFAULT NULL,
        localidad VARCHAR(100) DEFAULT NULL,
        cp VARCHAR(10) DEFAULT NULL,
        provincia VARCHAR(100) DEFAULT NULL,
        transporte VARCHAR(100) DEFAULT NULL,
        notas TEXT DEFAULT NULL,
        eliminado TINYINT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $db->query("CREATE TABLE IF NOT EXISTS pedidos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        cliente_id INT NOT NULL,
        estado ENUM('PENDIENTE','EN_PREPARACION','FACTURADO','ENVIADO','ELIMINADO') NOT NULL DEFAULT 'PENDIENTE',
        total DECIMAL(12,2) NOT NULL DEFAULT 0,
        observaciones TEXT DEFAULT NULL,
        facturas VARCHAR(500) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $colCheck = $db->query("SHOW COLUMNS FROM clientes LIKE 'eliminado'");
    if ($colCheck && $colCheck->num_rows === 0) $db->query("ALTER TABLE clientes ADD COLUMN eliminado TINYINT DEFAULT 0");
    $db->query("ALTER TABLE pedidos MODIFY COLUMN estado ENUM('PENDIENTE','EN_PREPARACION','FACTURADO','ENVIADO','ELIMINADO') NOT NULL DEFAULT 'PENDIENTE'");

    $db->query("CREATE TABLE IF NOT EXISTS pedido_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        pedido_id INT NOT NULL,
        codigo VARCHAR(50) NOT NULL,
        descripcion VARCHAR(255) NOT NULL,
        cantidad INT NOT NULL DEFAULT 1,
        precio_unitario DECIMAL(12,2) NOT NULL DEFAULT 0,
        subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
        en_lista_espera TINYINT(1) NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $colCheck = $db->query("SHOW COLUMNS FROM pedido_items LIKE 'en_lista_espera'");
    if ($colCheck && $colCheck->num_rows === 0) {
        $db->query("ALTER TABLE pedido_items ADD COLUMN en_lista_espera TINYINT(1) NOT NULL DEFAULT 0");
    }

    // Snapshot del nombre de la preventa al momento del pedido — no se
    // resuelve por JOIN al imprimir, para que un pedido viejo siga agrupado
    // igual aunque después se reasigne o borre la preventa del producto.
    $colCheck = $db->query("SHOW COLUMNS FROM pedido_items LIKE 'preventa_nombre'");
    if ($colCheck && $colCheck->num_rows === 0) {
        $db->query("ALTER TABLE pedido_items ADD COLUMN preventa_nombre VARCHAR(150) DEFAULT NULL");
    }

    $db->query("CREATE TABLE IF NOT EXISTS pedido_estados (
        id INT AUTO_INCREMENT PRIMARY KEY,
        pedido_id INT NOT NULL,
        estado VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

// Resuelve el nombre de preventa (texto libre de la planilla) contra una
// preventa YA EXISTENTE — a propósito no crea preventas nuevas desde el
// Excel, porque activarlas es una decisión manual de Mauricio. Si no matchea
// ninguna, devuelve null y el producto queda sin preventa (oculto).
function resolver_preventa_id($db, $nombre) {
    $nombre = trim($nombre ?? '');
    if ($nombre === '') return null;
    $stmt = $db->prepare("SELECT id FROM preventas WHERE LOWER(nombre) = LOWER(?)");
    $stmt->bind_param('s', $nombre);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    return $row ? intval($row['id']) : null;
}

function normalizarTel($tel) {
    $tel = preg_replace('/[^0-9]/', '', $tel);
    if (substr($tel, 0, 2) === '54') $tel = substr($tel, 2);
    if (substr($tel, 0, 1) === '0') $tel = substr($tel, 1);
    if (strlen($tel) > 10 && substr($tel, 3, 2) === '15') $tel = substr($tel, 0, 3) . substr($tel, 5);
    return '54' . $tel;
}

$action = $_GET['action'] ?? '';
$db = getDB();
setupDB($db);

switch ($action) {

    case 'productos':
        $cat      = $_GET['categoria'] ?? '';
        $q        = $_GET['q'] ?? '';
        $barcode  = $_GET['barcode'] ?? '';
        $preventa = $_GET['preventa'] ?? ''; // id de preventa, o 'sin' para sin preventa asignada
        $isAdmin  = isAdminAuth($_GET['_user'] ?? '', $_GET['_pass'] ?? '');
        $sql = "SELECT p.*, COALESCE(c.orden, 0) as cat_orden, pv.nombre as preventa_nombre, pv.detalle as preventa_detalle, pv.activa as preventa_activa, pv.imagen as preventa_imagen, pv.orden as preventa_orden
                FROM productos p
                LEFT JOIN categorias c ON p.categoria = c.nombre
                LEFT JOIN preventas pv ON p.preventa_id = pv.id
                WHERE 1=1";
        $params = []; $types = '';
        // Visibilidad pública: un producto solo se muestra si tiene preventa
        // asignada y esa preventa está activa. El admin (autenticado) ve todo,
        // incluidos productos sin preventa o con preventa inactiva, para poder
        // gestionarlos.
        if (!$isAdmin) { $sql .= " AND pv.activa = 1"; }
        if ($cat)     { $sql .= " AND p.categoria = ?"; $params[] = $cat; $types .= 's'; }
        if ($barcode) { $sql .= " AND p.codigo_barras = ?"; $params[] = $barcode; $types .= 's'; }
        elseif ($q)   { $sql .= " AND (p.descripcion LIKE ? OR p.codigo LIKE ? OR p.codigo_barras LIKE ?)"; $like = "%$q%"; $params[] = $like; $params[] = $like; $params[] = $like; $types .= 'sss'; }
        if ($preventa === 'sin') { $sql .= " AND p.preventa_id IS NULL"; }
        elseif ($preventa !== '') { $sql .= " AND p.preventa_id = ?"; $params[] = intval($preventa); $types .= 'i'; }
        $sql .= " ORDER BY COALESCE(c.orden, 0), p.orden, p.codigo";
        $stmt = $db->prepare($sql);
        if ($params) $stmt->bind_param($types, ...$params);
        $stmt->execute();
        $productos = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
        foreach ($productos as &$prod) {
            $cstmt = $db->prepare("SELECT c.id, c.nombre, c.hex FROM colores c JOIN producto_colores pc ON c.id = pc.color_id WHERE pc.producto_id = ? ORDER BY c.nombre");
            $cstmt->bind_param('i', $prod['id']);
            $cstmt->execute();
            $prod['colores'] = $cstmt->get_result()->fetch_all(MYSQLI_ASSOC);
        }
        echo json_encode($productos);
        break;

    case 'check_codigo':
        $codigo = $_GET['codigo'] ?? '';
        $excludeId = intval($_GET['exclude_id'] ?? 0);
        $stmt = $db->prepare("SELECT id FROM productos WHERE codigo = ? AND id != ?");
        $stmt->bind_param('si', $codigo, $excludeId);
        $stmt->execute();
        echo json_encode(['exists' => $stmt->get_result()->num_rows > 0]);
        break;

    case 'cambiar_password':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $nueva = trim($data['nueva'] ?? '');
        if (strlen($nueva) < 6) { http_response_code(400); die(json_encode(['error' => 'Contraseña muy corta'])); }
        $stmt = $db->prepare("INSERT INTO config (clave, valor) VALUES ('admin_pass', ?) ON DUPLICATE KEY UPDATE valor=?");
        $stmt->bind_param('ss', $nueva, $nueva);
        $stmt->execute();
        echo json_encode(['ok' => true]);
        break;

    case 'login':
        $data = json_decode(file_get_contents('php://input'), true);
        $u = $data['user'] ?? '';
        $p = $data['pass'] ?? '';
        $r = $db->query("SELECT valor FROM config WHERE clave='admin_pass' LIMIT 1");
        $row = $r ? $r->fetch_assoc() : null;
        $validPass = $row ? $row['valor'] : ADMIN_PASS;
        if ($u === ADMIN_USER && $p === $validPass) echo json_encode(['ok' => true]);
        else { http_response_code(401); echo json_encode(['error' => 'Credenciales inválidas']); }
        break;

    case 'manager_buscar_producto':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $codigo = trim($data['codigo'] ?? '');
        if (!$codigo) { http_response_code(400); die(json_encode(['error' => 'código requerido'])); }
        try {
            $token = manager_login();
            $articulo = manager_buscar_por_codigo($token, $codigo);
            if (!$articulo) { echo json_encode(['ok' => true, 'encontrado' => false]); break; }
            $categoria = trim($articulo['Rubro'] ?? '');
            echo json_encode([
                'ok' => true,
                'encontrado' => true,
                'producto' => [
                    'codigo' => $codigo,
                    'descripcion' => trim($articulo['Descripcion'] ?? ''),
                    'categoria' => $categoria !== '' ? mb_strtoupper($categoria, 'UTF-8') : '',
                    'marca' => trim($articulo['Marca'] ?? ''),
                    'precio_mayorista' => manager_precio_por_codigo($token, $codigo, MANAGER_LISTA_MAYORISTA),
                ],
            ]);
        } catch (Exception $e) {
            http_response_code(500);
            echo json_encode(['error' => $e->getMessage()]);
        }
        break;

    case 'producto':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $orden = intval($data['orden'] ?? 0);
        $multiplo = max(1, intval($data['multiplo'] ?? 1));
        $codigoBarras = isset($data['codigo_barras']) && $data['codigo_barras'] !== '' ? trim($data['codigo_barras']) : null;
        $stockInicial = max(0, intval($data['stock_preventa'] ?? 0));
        $preventaId = isset($data['preventa_id']) && $data['preventa_id'] !== '' ? intval($data['preventa_id']) : null;
        $stmt = $db->prepare("INSERT INTO productos (codigo,descripcion,categoria,precio_mayorista,foto,estado,orden,multiplo,codigo_barras,stock_preventa,stock_preventa_inicial,preventa_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
        $stmt->bind_param('sssdssiisiii', $data['codigo'], $data['descripcion'], $data['categoria'], $data['precio_mayorista'], $data['foto'], $data['estado'], $orden, $multiplo, $codigoBarras, $stockInicial, $stockInicial, $preventaId);
        if ($stmt->execute()) {
            $newId = $db->insert_id;
            $colores = $data['colores'] ?? [];
            foreach ($colores as $cid) {
                $cid = intval($cid);
                $cs = $db->prepare("INSERT IGNORE INTO producto_colores (producto_id, color_id) VALUES (?,?)");
                $cs->bind_param('ii', $newId, $cid);
                $cs->execute();
            }
            echo json_encode(['ok' => true, 'id' => $newId]);
        } else { http_response_code(400); echo json_encode(['error' => $db->error]); }
        break;

    case 'editar':
        $id = intval($_GET['id'] ?? 0);
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $multiplo = max(1, intval($data['multiplo'] ?? 1));
        $codigoBarras = isset($data['codigo_barras']) && $data['codigo_barras'] !== '' ? trim($data['codigo_barras']) : null;
        $ordenActual = $db->query("SELECT orden FROM productos WHERE id=$id")->fetch_assoc();
        $orden = isset($data['orden']) && $data['orden'] !== '' ? intval($data['orden']) : ($ordenActual['orden'] ?? 0);
        // stock_preventa se puede corregir a mano desde el formulario de edición
        // (para sumar stock de verdad, ver el endpoint "stock_agregar", que
        // además lleva el acumulado en stock_preventa_inicial).
        $stock = max(0, intval($data['stock_preventa'] ?? 0));
        $preventaId = isset($data['preventa_id']) && $data['preventa_id'] !== '' ? intval($data['preventa_id']) : null;
        $stmt = $db->prepare("UPDATE productos SET codigo=?,descripcion=?,categoria=?,precio_mayorista=?,foto=?,estado=?,orden=?,multiplo=?,codigo_barras=?,stock_preventa=?,preventa_id=?,updated_at=NOW() WHERE id=?");
        $stmt->bind_param('sssdssiisiii', $data['codigo'], $data['descripcion'], $data['categoria'], $data['precio_mayorista'], $data['foto'], $data['estado'], $orden, $multiplo, $codigoBarras, $stock, $preventaId, $id);
        if ($stmt->execute()) {
            if (isset($data['colores'])) {
                $delStmt = $db->prepare("DELETE FROM producto_colores WHERE producto_id=?");
                $delStmt->bind_param('i', $id);
                $delStmt->execute();
                foreach ($data['colores'] as $cid) {
                    $cid = intval($cid);
                    $cs = $db->prepare("INSERT IGNORE INTO producto_colores (producto_id, color_id) VALUES (?,?)");
                    $cs->bind_param('ii', $id, $cid);
                    $cs->execute();
                }
            }
            echo json_encode(['ok' => true]);
        } else { http_response_code(400); echo json_encode(['error' => $db->error]); }
        break;

    case 'stock_agregar':
        // Acción rápida del admin: "llegó/confirmé más mercadería de este
        // producto en preventa" — suma unidades sin tocar el resto del producto.
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $id = intval($_GET['id'] ?? 0);
        $cantidad = intval($data['cantidad'] ?? 0);
        if ($id <= 0 || $cantidad <= 0) { http_response_code(400); die(json_encode(['error' => 'id y cantidad (>0) requeridos'])); }
        $stmt = $db->prepare("UPDATE productos SET stock_preventa = stock_preventa + ?, stock_preventa_inicial = stock_preventa_inicial + ? WHERE id=?");
        $stmt->bind_param('iii', $cantidad, $cantidad, $id);
        if ($stmt->execute()) {
            $row = $db->query("SELECT stock_preventa, stock_preventa_inicial FROM productos WHERE id=$id")->fetch_assoc();
            echo json_encode(['ok' => true, 'stock_preventa' => intval($row['stock_preventa']), 'stock_preventa_inicial' => intval($row['stock_preventa_inicial'])]);
        } else { http_response_code(400); echo json_encode(['error' => $db->error]); }
        break;

    case 'eliminar':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $id = intval($_GET['id'] ?? 0);
        $stmtFoto = $db->prepare("SELECT foto, codigo FROM productos WHERE id=?");
        $stmtFoto->bind_param('i', $id);
        $stmtFoto->execute();
        $prod = $stmtFoto->get_result()->fetch_assoc();
        $stmt = $db->prepare("DELETE FROM productos WHERE id=?");
        $stmt->bind_param('i', $id);
        $stmt->execute();
        $deleted_img = false;
        if ($prod) {
            $imgPath = null;
            if (!empty($prod['foto']) && strpos($prod['foto'], 'http') === false) {
                $imgPath = __DIR__ . '/' . $prod['foto'];
            } else {
                $codigo = str_replace('/', '_', $prod['codigo'] ?? '');
                $imgPath = __DIR__ . '/imgs/' . $codigo . '.jpeg';
            }
            if ($imgPath && file_exists($imgPath)) { unlink($imgPath); $deleted_img = true; }
        }
        echo json_encode(['ok' => true, 'affected' => $stmt->affected_rows, 'deleted_img' => $deleted_img]);
        break;

    case 'reordenar':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        foreach ($data['orden'] ?? [] as $item) {
            $id = intval($item['id']); $o = intval($item['orden']);
            $stmt = $db->prepare("UPDATE productos SET orden=? WHERE id=?");
            $stmt->bind_param('ii', $o, $id);
            $stmt->execute();
        }
        echo json_encode(['ok' => true]);
        break;

    case 'reordenar_categorias':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        foreach ($data['orden'] ?? [] as $item) {
            $id = intval($item['id']); $o = intval($item['orden']);
            $stmt = $db->prepare("UPDATE categorias SET orden=? WHERE id=?");
            $stmt->bind_param('ii', $o, $id);
            $stmt->execute();
        }
        echo json_encode(['ok' => true]);
        break;

    case 'importar':
        $data = json_decode(file_get_contents('php://input'), true);
        $creds = $data['creds'] ?? [];
        if (($creds['user'] ?? '') !== ADMIN_USER || ($creds['pass'] ?? '') !== ADMIN_PASS) {
            http_response_code(401); die(json_encode(['error' => 'No autorizado']));
        }
        $productos = $data['productos'] ?? [];
        $imported = 0; $errors = [];
        $cats = array_unique(array_column($productos, 'CATEGORIA'));
        foreach ($cats as $i => $cat) {
            $stmt = $db->prepare("INSERT IGNORE INTO categorias (nombre, orden) VALUES (?, ?)");
            $stmt->bind_param('si', $cat, $i);
            $stmt->execute();
        }
        foreach ($productos as $p) {
            $foto = $p['FOTO'] ?? null; $o = 0; $multiplo = 1;
            $estado = strtoupper($p['ESTADO'] ?? 'DISPONIBLE');
            $codigoBarras = isset($p['CODIGO_BARRAS']) && $p['CODIGO_BARRAS'] !== '' ? trim($p['CODIGO_BARRAS']) : null;
            $stock = max(0, intval($p['STOCK_PREVENTA'] ?? 0));
            $stmt = $db->prepare("INSERT IGNORE INTO productos (codigo,descripcion,categoria,precio_mayorista,foto,estado,orden,multiplo,codigo_barras,stock_preventa,stock_preventa_inicial) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
            $stmt->bind_param('sssdssiisii', $p['CODIGO'], $p['DESCRIPCION'], $p['CATEGORIA'], $p['PRECIO_MAYORISTA'], $foto, $estado, $o, $multiplo, $codigoBarras, $stock, $stock);
            if ($stmt->execute()) $imported++;
            else $errors[] = $p['CODIGO'];
        }
        echo json_encode(['ok' => true, 'imported' => $imported, 'errors' => $errors]);
        break;

    case 'importar_masivo':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $productos = $data['productos'] ?? [];
        if (empty($productos)) { http_response_code(400); die(json_encode(['error' => 'Sin productos'])); }
        $imported = 0; $updated = 0; $errors = [];

        $import_id = 'imp_' . date('Ymd_His') . '_' . substr(uniqid(), -4);

        $db->query("DELETE FROM import_snapshots WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)");

        $cats = array_unique(array_column($productos, 'CATEGORIA'));
        $cats = array_filter($cats);
        foreach (array_values($cats) as $i => $cat) {
            $stmt = $db->prepare("INSERT IGNORE INTO categorias (nombre, orden) VALUES (?, ?)");
            $stmt->bind_param('si', $cat, $i);
            $stmt->execute();
        }

        foreach ($productos as $p) {
            $codigo = trim($p['CODIGO'] ?? '');
            if (!$codigo) { $errors[] = ['codigo' => '(vacío)', 'motivo' => 'CODIGO obligatorio']; continue; }

            $chk = $db->prepare("SELECT codigo,descripcion,categoria,precio_mayorista,estado,codigo_barras FROM productos WHERE codigo=?");
            $chk->bind_param('s', $codigo); $chk->execute();
            $existing = $chk->get_result()->fetch_assoc();

            if ($existing) {
                // Actualiza datos del producto. A propósito NO toca stock_preventa
                // acá — para sumar stock de un producto ya cargado se usa
                // "stock_agregar" desde el admin, así no se pisa en silencio lo
                // que ya se vendió con una reimportación de precios/descripciones.
                $prevJson = json_encode($existing, JSON_UNESCAPED_UNICODE);
                $snapStmt = $db->prepare("INSERT INTO import_snapshots (import_id, codigo, accion, datos_anteriores) VALUES (?,?,'updated',?)");
                $snapStmt->bind_param('sss', $import_id, $codigo, $prevJson);
                $snapStmt->execute();

                $sets = []; $params = []; $types = '';
                if (isset($p['DESCRIPCION'])    && $p['DESCRIPCION']    !== '') { $sets[] = 'descripcion=?';      $params[] = trim($p['DESCRIPCION']);           $types .= 's'; }
                if (isset($p['CATEGORIA'])      && $p['CATEGORIA']      !== '') { $sets[] = 'categoria=?';        $params[] = trim($p['CATEGORIA']);             $types .= 's'; }
                if (isset($p['PRECIO_MAYORISTA']) && $p['PRECIO_MAYORISTA'] !== '') { $sets[] = 'precio_mayorista=?'; $params[] = floatval($p['PRECIO_MAYORISTA']); $types .= 'd'; }
                if (isset($p['ESTADO'])         && $p['ESTADO']         !== '') { $sets[] = 'estado=?';           $params[] = strtoupper(trim($p['ESTADO']));    $types .= 's'; }
                if (isset($p['CODIGO_BARRAS'])  && $p['CODIGO_BARRAS']  !== '') { $sets[] = 'codigo_barras=?';    $params[] = trim($p['CODIGO_BARRAS']);          $types .= 's'; }
                if (isset($p['PREVENTA'])       && $p['PREVENTA']       !== '') { $sets[] = 'preventa_id=?';      $params[] = resolver_preventa_id($db, $p['PREVENTA']); $types .= 'i'; }
                if (empty($sets)) { $updated++; continue; }
                $params[] = $codigo; $types .= 's';
                $stmt = $db->prepare("UPDATE productos SET " . implode(',', $sets) . " WHERE codigo=?");
                $stmt->bind_param($types, ...$params);
                if ($stmt->execute()) $updated++;
                else $errors[] = ['codigo' => $codigo, 'motivo' => $db->error];
            } else {
                $snapStmt = $db->prepare("INSERT INTO import_snapshots (import_id, codigo, accion, datos_anteriores) VALUES (?,?,'inserted',NULL)");
                $snapStmt->bind_param('ss', $import_id, $codigo);
                $snapStmt->execute();

                $desc   = trim($p['DESCRIPCION'] ?? '');
                $cat    = trim($p['CATEGORIA']   ?? '');
                $may    = floatval($p['PRECIO_MAYORISTA'] ?? 0);
                $estado = strtoupper(trim($p['ESTADO'] ?? 'DISPONIBLE'));
                $cb     = isset($p['CODIGO_BARRAS']) && $p['CODIGO_BARRAS'] !== '' ? trim($p['CODIGO_BARRAS']) : null;
                $stock  = max(0, intval($p['STOCK_PREVENTA'] ?? 0));
                $preventaId = resolver_preventa_id($db, $p['PREVENTA'] ?? '');
                if (!$desc || !$cat) { $errors[] = ['codigo' => $codigo, 'motivo' => 'DESCRIPCION y CATEGORIA obligatorias para producto nuevo']; continue; }
                $o = 0; $multiplo = 1;
                $stmt = $db->prepare("INSERT INTO productos (codigo,descripcion,categoria,precio_mayorista,estado,orden,multiplo,codigo_barras,stock_preventa,stock_preventa_inicial,preventa_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
                $stmt->bind_param('sssdsiisiii', $codigo, $desc, $cat, $may, $estado, $o, $multiplo, $cb, $stock, $stock, $preventaId);
                if ($stmt->execute()) $imported++;
                else $errors[] = ['codigo' => $codigo, 'motivo' => $db->error];
            }
        }
        echo json_encode(['ok' => true, 'imported' => $imported, 'updated' => $updated, 'errors' => $errors, 'import_id' => $import_id]);
        break;

    case 'import_last':
        $r = $db->query("SELECT import_id, created_at, COUNT(*) as n FROM import_snapshots GROUP BY import_id, created_at ORDER BY created_at DESC LIMIT 1");
        $row = $r ? $r->fetch_assoc() : null;
        echo json_encode($row ? ['ok' => true, 'import_id' => $row['import_id'], 'created_at' => $row['created_at'], 'n' => intval($row['n'])] : ['ok' => true, 'import_id' => null]);
        break;

    case 'check_codigos':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $codigos = array_values(array_filter(array_map('trim', $data['codigos'] ?? []), 'strlen'));
        if (!$codigos) { echo json_encode(['ok' => true, 'productos' => (object)[]]); break; }
        $ph = implode(',', array_fill(0, count($codigos), '?'));
        $types = str_repeat('s', count($codigos));
        $stmt = $db->prepare("SELECT codigo, descripcion, categoria, precio_mayorista, estado, codigo_barras FROM productos WHERE codigo IN ($ph)");
        $stmt->bind_param($types, ...$codigos);
        $stmt->execute();
        $res = $stmt->get_result();
        $productos = [];
        while ($row = $res->fetch_assoc()) { $productos[$row['codigo']] = $row; }
        echo json_encode(['ok' => true, 'productos' => $productos ?: (object)[]]);
        break;

    case 'import_rollback':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $import_id = trim($data['import_id'] ?? '');
        if (!$import_id) { http_response_code(400); die(json_encode(['error' => 'import_id requerido'])); }

        try {
            $r = $db->prepare("SELECT codigo, accion, datos_anteriores FROM import_snapshots WHERE import_id=?");
            if (!$r) throw new Exception("prepare SELECT falló: " . $db->error);
            $r->bind_param('s', $import_id);
            $r->execute();
            $res = $r->get_result();
            if (!$res) throw new Exception("get_result falló: " . $db->error);
            $rows = $res->fetch_all(MYSQLI_ASSOC);
            $r->close();

            if (empty($rows)) { http_response_code(404); die(json_encode(['error' => 'No se encontró esa importación'])); }

            $restored = 0; $errors = [];
            foreach ($rows as $row) {
                if ($row['accion'] === 'updated') {
                    $prev = json_decode($row['datos_anteriores'], true);
                    if (!$prev) { $errors[] = ['codigo' => $row['codigo'], 'motivo' => 'snapshot JSON inválido']; continue; }
                    $desc  = $prev['descripcion']     ?? '';
                    $cat   = $prev['categoria']       ?? '';
                    $pmay  = floatval($prev['precio_mayorista'] ?? 0);
                    $est   = $prev['estado']          ?? 'DISPONIBLE';
                    $cb    = isset($prev['codigo_barras']) && $prev['codigo_barras'] !== null ? strval($prev['codigo_barras']) : null;
                    $cod   = $row['codigo'];

                    $stmt = $db->prepare("UPDATE productos SET descripcion=?,categoria=?,precio_mayorista=?,estado=?,codigo_barras=? WHERE codigo=?");
                    if (!$stmt) throw new Exception("prepare UPDATE falló para " . $cod . ": " . $db->error);
                    $stmt->bind_param('ssdsss', $desc, $cat, $pmay, $est, $cb, $cod);
                    if ($stmt->execute()) $restored++;
                    else $errors[] = ['codigo' => $cod, 'motivo' => $stmt->error];
                    $stmt->close();
                } elseif ($row['accion'] === 'inserted') {
                    $cod = $row['codigo'];
                    $del = $db->prepare("DELETE FROM productos WHERE codigo=?");
                    if (!$del) throw new Exception("prepare DELETE falló para " . $cod . ": " . $db->error);
                    $del->bind_param('s', $cod);
                    $del->execute();
                    $del->close();
                    $restored++;
                }
            }
            $delSnap = $db->prepare("DELETE FROM import_snapshots WHERE import_id=?");
            if (!$delSnap) throw new Exception("prepare DELETE snapshots falló: " . $db->error);
            $delSnap->bind_param('s', $import_id);
            $delSnap->execute();
            $delSnap->close();

            echo json_encode(['ok' => true, 'restored' => $restored, 'errors' => $errors]);
        } catch (Exception $e) {
            http_response_code(500);
            echo json_encode(['error' => 'import_rollback: ' . $e->getMessage()]);
        }
        break;

    case 'categorias':
        $r = $db->query("SELECT * FROM categorias ORDER BY orden, nombre");
        echo json_encode($r->fetch_all(MYSQLI_ASSOC));
        break;

    case 'categoria_crear':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $nombre = mb_strtoupper(trim($data['nombre'] ?? ''), 'UTF-8');
        $orden = intval($data['orden'] ?? 0);
        if (!$nombre) { http_response_code(400); die(json_encode(['error' => 'Nombre requerido'])); }
        $stmt = $db->prepare("INSERT INTO categorias (nombre, orden) VALUES (?, ?)");
        $stmt->bind_param('si', $nombre, $orden);
        if ($stmt->execute()) echo json_encode(['ok' => true, 'id' => $db->insert_id]);
        else { http_response_code(400); echo json_encode(['error' => 'Ya existe esa categoría']); }
        break;

    case 'categoria_editar':
        $id = intval($_GET['id'] ?? 0);
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $nombre = mb_strtoupper(trim($data['nombre'] ?? ''), 'UTF-8');
        $orden = intval($data['orden'] ?? 0);
        $oldStmt = $db->prepare("SELECT nombre FROM categorias WHERE id=?");
        $oldStmt->bind_param('i', $id); $oldStmt->execute();
        $old = $oldStmt->get_result()->fetch_assoc();
        if ($old) {
            $stmt = $db->prepare("UPDATE categorias SET nombre=?, orden=? WHERE id=?");
            $stmt->bind_param('sii', $nombre, $orden, $id); $stmt->execute();
            $stmt2 = $db->prepare("UPDATE productos SET categoria=? WHERE categoria=?");
            $stmt2->bind_param('ss', $nombre, $old['nombre']); $stmt2->execute();
        }
        echo json_encode(['ok' => true]);
        break;

    case 'categoria_eliminar':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $id = intval($_GET['id'] ?? 0);
        $check = $db->prepare("SELECT COUNT(*) as n FROM productos p JOIN categorias c ON p.categoria=c.nombre WHERE c.id=?");
        $check->bind_param('i', $id); $check->execute();
        $row = $check->get_result()->fetch_assoc();
        if ($row['n'] > 0) { http_response_code(400); echo json_encode(['error' => 'No se puede eliminar: tiene ' . $row['n'] . ' producto(s)']); break; }
        $stmt = $db->prepare("DELETE FROM categorias WHERE id=?");
        $stmt->bind_param('i', $id); $stmt->execute();
        echo json_encode(['ok' => true]);
        break;

    // ── PREVENTAS ─────────────────────────────────────────────────────────────
    case 'preventas':
        $r = $db->query("SELECT p.*, COUNT(pr.id) as n_productos
            FROM preventas p LEFT JOIN productos pr ON pr.preventa_id = p.id
            GROUP BY p.id ORDER BY p.orden, p.nombre");
        echo json_encode($r->fetch_all(MYSQLI_ASSOC));
        break;

    case 'preventa_crear':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $nombre = trim($data['nombre'] ?? '');
        $detalle = isset($data['detalle']) && $data['detalle'] !== '' ? trim($data['detalle']) : null;
        $imagen = isset($data['imagen']) && $data['imagen'] !== '' ? trim($data['imagen']) : null;
        $activa = !empty($data['activa']) ? 1 : 0;
        $orden = intval($data['orden'] ?? 0);
        if (!$nombre) { http_response_code(400); die(json_encode(['error' => 'Nombre requerido'])); }
        $stmt = $db->prepare("INSERT INTO preventas (nombre, detalle, imagen, activa, orden) VALUES (?, ?, ?, ?, ?)");
        $stmt->bind_param('sssii', $nombre, $detalle, $imagen, $activa, $orden);
        if ($stmt->execute()) echo json_encode(['ok' => true, 'id' => $db->insert_id]);
        else { http_response_code(400); echo json_encode(['error' => 'Ya existe esa preventa']); }
        break;

    case 'preventa_editar':
        $id = intval($_GET['id'] ?? 0);
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $nombre = trim($data['nombre'] ?? '');
        $detalle = isset($data['detalle']) && $data['detalle'] !== '' ? trim($data['detalle']) : null;
        $activa = !empty($data['activa']) ? 1 : 0;
        if (isset($data['imagen'])) {
            $imagen = $data['imagen'] !== '' ? trim($data['imagen']) : null;
            $stmt = $db->prepare("UPDATE preventas SET nombre=?, detalle=?, imagen=?, activa=? WHERE id=?");
            $stmt->bind_param('sssii', $nombre, $detalle, $imagen, $activa, $id);
        } else {
            $stmt = $db->prepare("UPDATE preventas SET nombre=?, detalle=?, activa=? WHERE id=?");
            $stmt->bind_param('ssii', $nombre, $detalle, $activa, $id);
        }
        if ($stmt->execute()) echo json_encode(['ok' => true]);
        else { http_response_code(400); echo json_encode(['error' => $db->error]); }
        break;

    case 'preventa_eliminar':
        // Decisión de negocio: no se bloquea el borrado por tener productos
        // asignados — quedan sin preventa (preventa_id=NULL) y por lo tanto
        // dejan de mostrarse en el catálogo público hasta que se les asigne
        // otra preventa activa.
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $id = intval($_GET['id'] ?? 0);
        $stmtImg = $db->prepare("SELECT imagen FROM preventas WHERE id=?");
        $stmtImg->bind_param('i', $id); $stmtImg->execute();
        $prev = $stmtImg->get_result()->fetch_assoc();
        $upd = $db->prepare("UPDATE productos SET preventa_id=NULL WHERE preventa_id=?");
        $upd->bind_param('i', $id); $upd->execute();
        $stmt = $db->prepare("DELETE FROM preventas WHERE id=?");
        $stmt->bind_param('i', $id); $stmt->execute();
        if ($prev && !empty($prev['imagen']) && strpos($prev['imagen'], 'http') === false) {
            $imgPath = __DIR__ . '/' . $prev['imagen'];
            if (file_exists($imgPath)) unlink($imgPath);
        }
        echo json_encode(['ok' => true]);
        break;

    case 'reordenar_preventas':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        foreach ($data['orden'] ?? [] as $item) {
            $id = intval($item['id']); $o = intval($item['orden']);
            $stmt = $db->prepare("UPDATE preventas SET orden=? WHERE id=?");
            $stmt->bind_param('ii', $o, $id);
            $stmt->execute();
        }
        echo json_encode(['ok' => true]);
        break;

    // Asigna (o desasigna, si preventa_id viene vacío) UN producto ya cargado
    // a una preventa. No toca ningún otro campo del producto — a propósito
    // separado de "editar" para no arriesgar pisar datos con un payload
    // parcial. Usado desde el modal "Productos" de cada preventa.
    case 'producto_asignar_preventa':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $id = intval($_GET['id'] ?? 0);
        if (!$id) { http_response_code(400); die(json_encode(['error' => 'id requerido'])); }
        $preventaId = isset($data['preventa_id']) && $data['preventa_id'] !== '' ? intval($data['preventa_id']) : null;
        $stmt = $db->prepare("UPDATE productos SET preventa_id=? WHERE id=?");
        $stmt->bind_param('ii', $preventaId, $id);
        if ($stmt->execute()) echo json_encode(['ok' => true]);
        else { http_response_code(400); echo json_encode(['error' => $db->error]); }
        break;

    // Asigna en bloque una lista de códigos YA CARGADOS a una preventa — no
    // busca nada en Manager, solo reasigna preventa_id de productos
    // existentes. Si un código ya pertenece a otra preventa, se reasigna sin
    // preguntar (decisión de Mauricio, 31/08/2026) — se devuelve de dónde
    // venía cada uno para armar el log en el frontend. Los códigos que no
    // existen en la tabla productos se listan aparte, sin crear nada (eso lo
    // hace la herramienta separada "Importar por código" contra Manager).
    case 'preventa_asignar_lote':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $preventaId = intval($data['preventa_id'] ?? 0);
        if (!$preventaId) { http_response_code(400); die(json_encode(['error' => 'preventa_id requerido'])); }
        $codigos = array_values(array_unique(array_filter(array_map('trim', $data['codigos'] ?? []), 'strlen')));
        if (!$codigos) { http_response_code(400); die(json_encode(['error' => 'Sin códigos'])); }

        $asignados = []; $noEncontrados = [];
        foreach ($codigos as $codigo) {
            $chk = $db->prepare("SELECT p.id, pv.nombre as preventa_anterior
                FROM productos p LEFT JOIN preventas pv ON pv.id = p.preventa_id
                WHERE p.codigo = ?");
            $chk->bind_param('s', $codigo);
            $chk->execute();
            $row = $chk->get_result()->fetch_assoc();
            if (!$row) { $noEncontrados[] = $codigo; continue; }

            $upd = $db->prepare("UPDATE productos SET preventa_id=? WHERE id=?");
            $upd->bind_param('ii', $preventaId, $row['id']);
            $upd->execute();
            $asignados[] = ['codigo' => $codigo, 'preventa_anterior' => $row['preventa_anterior']];
        }
        echo json_encode(['ok' => true, 'asignados' => $asignados, 'no_encontrados' => $noEncontrados]);
        break;

    // Búsqueda de la foto de un producto en Manager2Max, por código, para
    // completar automáticamente productos importados por Excel sin foto.
    // Solo-lectura contra Manager (GetDTArticulosImagenes/GetImage, ver la
    // regla del vault) — uno por uno, no en lote, por el límite de tiempo de
    // ejecución de PHP en hosting compartido (ver manager2max.md).
    case 'manager_imagen_producto':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $codigo = trim($data['codigo'] ?? '');
        if (!$codigo) { http_response_code(400); die(json_encode(['error' => 'código requerido'])); }
        try {
            $token = manager_login();
            $imagenes = manager_call($token, '/Api/ECommerce/GetDTArticulosImagenes', [
                'DTRequest' => ['draw' => 1, 'order' => [], 'start' => 0, 'length' => 20],
                'DefinicionTablaFiltros' => false,
                'CalculaTotales' => false,
                'ListFilters' => manager_dict_filtros(['CodigoArticulo' => manager_filtro_texto($codigo)]),
            ]);
            $principal = null;
            foreach ($imagenes as $img) {
                if (trim($img['CodigoArticulo'] ?? '') === $codigo && intval($img['Orden'] ?? 0) === 1) { $principal = $img; break; }
            }
            if (!$principal) { echo json_encode(['ok' => true, 'encontrada' => false]); break; }

            $imgResp = manager_call($token, '/Api/Image/GetImage', ['ImageFullPath' => $principal['PasoImagen']]);
            $base64 = $imgResp['ImageContent'] ?? null;
            if (!$base64) { echo json_encode(['ok' => true, 'encontrada' => false]); break; }

            $bytes = base64_decode($base64);
            $src = imagecreatefromstring($bytes);
            if (!$src) { echo json_encode(['ok' => true, 'encontrada' => false, 'error' => 'Imagen de Manager ilegible']); break; }

            $dst = redimensionar_a_cuadro($src, 800, 800);
            if (!is_dir(__DIR__ . '/imgs')) mkdir(__DIR__ . '/imgs', 0755, true);
            $filename = str_replace('/', '_', $codigo) . '.jpeg';
            imagejpeg($dst, __DIR__ . '/imgs/' . $filename, 85);
            imagedestroy($src);
            imagedestroy($dst);

            $foto = 'imgs/' . $filename;
            $stmt = $db->prepare("UPDATE productos SET foto=? WHERE codigo=?");
            $stmt->bind_param('ss', $foto, $codigo);
            $stmt->execute();

            echo json_encode(['ok' => true, 'encontrada' => true, 'foto' => $foto]);
        } catch (Exception $e) {
            http_response_code(500);
            echo json_encode(['error' => $e->getMessage()]);
        }
        break;

    // ── COLORES ───────────────────────────────────────────────────────────────
    case 'colores':
        $r = $db->query("SELECT * FROM colores ORDER BY nombre");
        echo json_encode($r->fetch_all(MYSQLI_ASSOC));
        break;

    case 'color_crear':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $nombre = trim($data['nombre'] ?? '');
        $hex = trim($data['hex'] ?? '');
        if (!$nombre || !$hex) { http_response_code(400); die(json_encode(['error' => 'Nombre y hex requeridos'])); }
        $stmt = $db->prepare("INSERT INTO colores (nombre, hex) VALUES (?, ?)");
        $stmt->bind_param('ss', $nombre, $hex);
        if ($stmt->execute()) echo json_encode(['ok' => true, 'id' => $db->insert_id]);
        else { http_response_code(400); echo json_encode(['error' => 'Ya existe ese color']); }
        break;

    case 'color_editar':
        $id = intval($_GET['id'] ?? 0);
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $nombre = trim($data['nombre'] ?? '');
        $hex = trim($data['hex'] ?? '');
        $stmt = $db->prepare("UPDATE colores SET nombre=?, hex=? WHERE id=?");
        $stmt->bind_param('ssi', $nombre, $hex, $id);
        $stmt->execute();
        echo json_encode(['ok' => true]);
        break;

    case 'color_eliminar':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $id = intval($_GET['id'] ?? 0);
        $stmt = $db->prepare("DELETE FROM colores WHERE id=?");
        $stmt->bind_param('i', $id);
        $stmt->execute();
        echo json_encode(['ok' => true]);
        break;

    case 'config_get':
        $clavesPublicas = ['whatsapp'];
        $ph = implode(',', array_fill(0, count($clavesPublicas), '?'));
        $stmt = $db->prepare("SELECT clave, valor FROM config WHERE clave IN ($ph)");
        $stmt->bind_param(str_repeat('s', count($clavesPublicas)), ...$clavesPublicas);
        $stmt->execute();
        $r = $stmt->get_result();
        $cfg = [];
        while ($row = $r->fetch_assoc()) $cfg[$row['clave']] = $row['valor'];
        echo json_encode($cfg);
        break;

    case 'config_set':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $clave = $data['clave'] ?? ''; $valor = $data['valor'] ?? '';
        if (!$clave) { http_response_code(400); die(json_encode(['error' => 'Clave requerida'])); }
        $stmt = $db->prepare("INSERT INTO config (clave, valor) VALUES (?,?) ON DUPLICATE KEY UPDATE valor=?");
        $stmt->bind_param('sss', $clave, $valor, $valor); $stmt->execute();
        echo json_encode(['ok' => true]);
        break;

    // ── TRANSPORTES ───────────────────────────────────────────────────────────
    case 'transportes':
        $r = $db->query("SELECT * FROM transportes WHERE activo=1 ORDER BY orden, nombre");
        echo json_encode($r->fetch_all(MYSQLI_ASSOC));
        break;

    case 'transporte_crear':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $nombre = mb_strtoupper(trim($data['nombre'] ?? ''), 'UTF-8');
        $orden = intval($data['orden'] ?? 0);
        if (!$nombre) { http_response_code(400); die(json_encode(['error' => 'Nombre requerido'])); }
        $stmt = $db->prepare("INSERT INTO transportes (nombre, orden) VALUES (?, ?)");
        $stmt->bind_param('si', $nombre, $orden);
        if ($stmt->execute()) echo json_encode(['ok' => true, 'id' => $db->insert_id]);
        else { http_response_code(400); echo json_encode(['error' => 'Ya existe']); }
        break;

    case 'transporte_editar':
        $id = intval($_GET['id'] ?? 0);
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $nombre = mb_strtoupper(trim($data['nombre'] ?? ''), 'UTF-8');
        $stmt = $db->prepare("UPDATE transportes SET nombre=? WHERE id=?");
        $stmt->bind_param('si', $nombre, $id);
        $stmt->execute();
        echo json_encode(['ok' => true]);
        break;

    case 'transporte_eliminar':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $id = intval($_GET['id'] ?? 0);
        $stmt = $db->prepare("UPDATE transportes SET activo=0 WHERE id=?");
        $stmt->bind_param('i', $id);
        $stmt->execute();
        echo json_encode(['ok' => true]);
        break;

    // ── CLIENTES ──────────────────────────────────────────────────────────────
    case 'cliente_buscar':
        $tel = trim($_GET['telefono'] ?? '');
        $tel = normalizarTel($tel);
        $stmt = $db->prepare("SELECT * FROM clientes WHERE telefono=?");
        $stmt->bind_param('s', $tel);
        $stmt->execute();
        $row = $stmt->get_result()->fetch_assoc();
        if ($row) echo json_encode(['found' => true, 'cliente' => $row]);
        else echo json_encode(['found' => false]);
        break;

    case 'cliente_guardar':
        $data = json_decode(file_get_contents('php://input'), true);
        $tel = normalizarTel($data['telefono'] ?? '');
        if (!$tel) { http_response_code(400); die(json_encode(['error' => 'Teléfono requerido'])); }
        $nombre    = trim($data['nombre'] ?? '');
        if (!$nombre) { http_response_code(400); die(json_encode(['error' => 'Nombre requerido'])); }
        $cuit_dni  = $data['cuit_dni']  ?? null;
        $email     = $data['email']     ?? null;
        $domicilio = $data['domicilio'] ?? null;
        $localidad = $data['localidad'] ?? null;
        $cp        = $data['cp']        ?? null;
        $provincia = $data['provincia'] ?? null;
        $transporte= $data['transporte']?? null;
        $notas     = $data['notas']     ?? null;
        $stmt = $db->prepare("INSERT INTO clientes (telefono,nombre,cuit_dni,email,domicilio,localidad,cp,provincia,transporte,notas)
            VALUES (?,?,?,?,?,?,?,?,?,?)
            ON DUPLICATE KEY UPDATE nombre=VALUES(nombre),cuit_dni=VALUES(cuit_dni),email=VALUES(email),
            domicilio=VALUES(domicilio),localidad=VALUES(localidad),cp=VALUES(cp),
            provincia=VALUES(provincia),transporte=VALUES(transporte),notas=VALUES(notas)");
        $stmt->bind_param('ssssssssss', $tel, $nombre, $cuit_dni, $email, $domicilio, $localidad, $cp, $provincia, $transporte, $notas);
        if ($stmt->execute()) {
            $idCliente = $db->insert_id ?: $db->query("SELECT id FROM clientes WHERE telefono='" . $db->real_escape_string($tel) . "'")->fetch_assoc()['id'];
            echo json_encode(['ok' => true, 'id' => $idCliente, 'telefono' => $tel]);
        } else { http_response_code(400); echo json_encode(['error' => $db->error]); }
        break;

    case 'clientes':
        $q = $_GET['q'] ?? '';
        $vista = $_GET['vista'] ?? 'activos';
        $sql = "SELECT c.*, COUNT(CASE WHEN p.estado != 'ELIMINADO' THEN 1 END) as total_pedidos
                FROM clientes c LEFT JOIN pedidos p ON p.cliente_id=c.id WHERE 1=1";
        if ($vista === 'activos') $sql .= " AND c.eliminado=0";
        elseif ($vista === 'eliminados') $sql .= " AND c.eliminado=1";
        if ($q) $sql .= " AND (c.nombre LIKE '%" . $db->real_escape_string($q) . "%' OR c.telefono LIKE '%" . $db->real_escape_string($q) . "%' OR c.cuit_dni LIKE '%" . $db->real_escape_string($q) . "%')";
        $sql .= " GROUP BY c.id ORDER BY c.nombre";
        echo json_encode($db->query($sql)->fetch_all(MYSQLI_ASSOC));
        break;

    case 'cliente_crear':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $tel = normalizarTel($data['telefono'] ?? '');
        $nombre = trim($data['nombre'] ?? '');
        if (!$tel || !$nombre) { http_response_code(400); die(json_encode(['error' => 'Teléfono y nombre son requeridos'])); }
        $cuit_dni = $data['cuit_dni'] ?? null; $email = $data['email'] ?? null;
        $domicilio = $data['domicilio'] ?? null; $localidad = $data['localidad'] ?? null;
        $cp = $data['cp'] ?? null; $provincia = $data['provincia'] ?? null;
        $transporte = $data['transporte'] ?? null; $notas = $data['notas'] ?? null;
        $stmt = $db->prepare("INSERT INTO clientes (telefono,nombre,cuit_dni,email,domicilio,localidad,cp,provincia,transporte,notas) VALUES (?,?,?,?,?,?,?,?,?,?)");
        $stmt->bind_param('ssssssssss', $tel, $nombre, $cuit_dni, $email, $domicilio, $localidad, $cp, $provincia, $transporte, $notas);
        if ($stmt->execute()) echo json_encode(['ok' => true, 'id' => $db->insert_id]);
        else { http_response_code(400); echo json_encode(['error' => 'El teléfono ya existe']); }
        break;

    case 'cliente_eliminar':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $id = intval($_GET['id'] ?? 0);
        $db->query("UPDATE clientes SET eliminado=1 WHERE id=$id");
        echo json_encode(['ok' => true]);
        break;

    case 'cliente_restaurar':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $id = intval($_GET['id'] ?? 0);
        $db->query("UPDATE clientes SET eliminado=0 WHERE id=$id");
        echo json_encode(['ok' => true]);
        break;

    case 'cliente_editar':
        $id = intval($_GET['id'] ?? 0);
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $stmt = $db->prepare("UPDATE clientes SET nombre=?,cuit_dni=?,email=?,domicilio=?,localidad=?,cp=?,provincia=?,transporte=?,notas=? WHERE id=?");
        $stmt->bind_param('sssssssssi',
            $data['nombre'], $data['cuit_dni'], $data['email'],
            $data['domicilio'], $data['localidad'], $data['cp'],
            $data['provincia'], $data['transporte'], $data['notas'], $id
        );
        $stmt->execute();
        echo json_encode(['ok' => true]);
        break;

    // ── PEDIDOS ───────────────────────────────────────────────────────────────
    // Control de stock de preventa: por cada ítem se toma el lock de la fila
    // del producto y se revalida el stock disponible en el momento real de
    // confirmar el pedido (no solo lo que el cliente vio al cargar la página),
    // para no sobrevender si dos clientes piden al mismo tiempo. Si no alcanza
    // el stock cargado, el ítem completo queda marcado en_lista_espera=1 y NO
    // se descuenta stock — el pedido igual se crea (regla de negocio: se manda
    // igual por WhatsApp aclarando "a confirmar stock").
    case 'pedido_crear':
        $data = json_decode(file_get_contents('php://input'), true);
        $cliente_id = intval($data['cliente_id'] ?? 0);
        $items = $data['items'] ?? [];
        $obs = $data['observaciones'] ?? '';
        if (!$cliente_id || !$items) { http_response_code(400); die(json_encode(['error' => 'Datos incompletos'])); }

        $db->begin_transaction();
        try {
            $estado = 'PENDIENTE';
            $totalReal = 0;
            $itemsProcesados = [];

            foreach ($items as $item) {
                $codigo = trim($item['codigo'] ?? '');
                $cantidad = max(1, intval($item['cantidad'] ?? 1));
                $precioUnit = floatval($item['precio_unitario'] ?? 0);
                $descripcion = $item['descripcion'] ?? '';

                $enListaEspera = 0;
                $lock = $db->prepare("SELECT p.stock_preventa, pv.nombre as preventa_nombre
                    FROM productos p LEFT JOIN preventas pv ON pv.id = p.preventa_id
                    WHERE p.codigo=? FOR UPDATE");
                $lock->bind_param('s', $codigo);
                $lock->execute();
                $prodRow = $lock->get_result()->fetch_assoc();
                $preventaNombre = $prodRow['preventa_nombre'] ?? null;

                if ($prodRow) {
                    $stockActual = intval($prodRow['stock_preventa']);
                    if ($stockActual >= $cantidad) {
                        $upd = $db->prepare("UPDATE productos SET stock_preventa = stock_preventa - ? WHERE codigo=?");
                        $upd->bind_param('is', $cantidad, $codigo);
                        $upd->execute();
                    } else {
                        // No alcanza el stock cargado (sea 0 o parcial): todo el
                        // ítem queda como lista de espera, sin descontar nada.
                        $enListaEspera = 1;
                    }
                } else {
                    // Código que no existe en la tabla productos (no debería
                    // pasar desde el catálogo, pero por las dudas no se bloquea
                    // el pedido completo por un ítem raro) — queda en lista de espera.
                    $enListaEspera = 1;
                }

                $subtotal = round($cantidad * $precioUnit, 2);
                $totalReal += $subtotal;
                $itemsProcesados[] = [
                    'codigo' => $codigo,
                    'descripcion' => $descripcion,
                    'cantidad' => $cantidad,
                    'precio_unitario' => $precioUnit,
                    'subtotal' => $subtotal,
                    'en_lista_espera' => $enListaEspera,
                    'preventa_nombre' => $preventaNombre,
                ];
            }

            $stmt = $db->prepare("INSERT INTO pedidos (cliente_id,estado,total,observaciones) VALUES (?,?,?,?)");
            $stmt->bind_param('isds', $cliente_id, $estado, $totalReal, $obs);
            $stmt->execute();
            $pedido_id = $db->insert_id;

            foreach ($itemsProcesados as $item) {
                $is = $db->prepare("INSERT INTO pedido_items (pedido_id,codigo,descripcion,cantidad,precio_unitario,subtotal,en_lista_espera,preventa_nombre) VALUES (?,?,?,?,?,?,?,?)");
                $is->bind_param('issiddis', $pedido_id, $item['codigo'], $item['descripcion'], $item['cantidad'], $item['precio_unitario'], $item['subtotal'], $item['en_lista_espera'], $item['preventa_nombre']);
                $is->execute();
            }

            $es = $db->prepare("INSERT INTO pedido_estados (pedido_id,estado) VALUES (?,?)");
            $es->bind_param('is', $pedido_id, $estado);
            $es->execute();

            $db->commit();
            $tieneListaEspera = false;
            foreach ($itemsProcesados as $it) if ($it['en_lista_espera']) { $tieneListaEspera = true; break; }
            echo json_encode(['ok' => true, 'id' => $pedido_id, 'total' => $totalReal, 'items' => $itemsProcesados, 'tiene_lista_espera' => $tieneListaEspera]);
        } catch (Exception $e) {
            $db->rollback();
            http_response_code(400);
            echo json_encode(['error' => $e->getMessage()]);
        }
        break;

    case 'pedidos':
        $q = $_GET['q'] ?? '';
        $est = $_GET['estado'] ?? '';
        $vista = $_GET['vista'] ?? 'activos'; // activos | todos | eliminados
        $sql = "SELECT p.*, c.nombre as cliente_nombre, c.telefono as cliente_tel,
                (SELECT COUNT(*) FROM pedido_items pi WHERE pi.pedido_id = p.id AND pi.en_lista_espera = 1) as items_lista_espera
                FROM pedidos p JOIN clientes c ON p.cliente_id=c.id WHERE 1=1";
        if ($vista === 'activos') $sql .= " AND p.estado != 'ELIMINADO'";
        elseif ($vista === 'eliminados') $sql .= " AND p.estado = 'ELIMINADO'";
        if ($q) $sql .= " AND (c.nombre LIKE '%" . $db->real_escape_string($q) . "%' OR c.telefono LIKE '%" . $db->real_escape_string($q) . "%')";
        if ($est && $est !== 'ELIMINADO') $sql .= " AND p.estado='" . $db->real_escape_string($est) . "'";
        elseif ($est === 'ELIMINADO') $sql .= " AND p.estado='ELIMINADO'";
        if (!empty($_GET['cliente_id'])) $sql .= " AND p.cliente_id=" . intval($_GET['cliente_id']);
        $sql .= " ORDER BY p.created_at DESC";
        echo json_encode($db->query($sql)->fetch_all(MYSQLI_ASSOC));
        break;

    case 'pedido_eliminar':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $id = intval($_GET['id'] ?? 0);
        $estado = 'ELIMINADO';
        $stmt = $db->prepare("UPDATE pedidos SET estado=? WHERE id=?");
        $stmt->bind_param('si', $estado, $id);
        $stmt->execute();
        $es = $db->prepare("INSERT INTO pedido_estados (pedido_id,estado) VALUES (?,?)");
        $es->bind_param('is', $id, $estado);
        $es->execute();
        echo json_encode(['ok' => true]);
        break;

    case 'pedido_restaurar':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $id = intval($_GET['id'] ?? 0);
        $estado = 'PENDIENTE';
        $stmt = $db->prepare("UPDATE pedidos SET estado=? WHERE id=?");
        $stmt->bind_param('si', $estado, $id);
        $stmt->execute();
        $es = $db->prepare("INSERT INTO pedido_estados (pedido_id,estado) VALUES (?,?)");
        $es->bind_param('is', $id, $estado);
        $es->execute();
        echo json_encode(['ok' => true]);
        break;

    case 'pedido_detalle':
        $id = intval($_GET['id'] ?? 0);
        $pedido = $db->query("SELECT p.*, c.nombre as cliente_nombre, c.telefono as cliente_tel,
            c.cuit_dni, c.email, c.domicilio, c.localidad, c.cp, c.provincia, c.transporte
            FROM pedidos p JOIN clientes c ON p.cliente_id=c.id WHERE p.id=$id")->fetch_assoc();
        if (!$pedido) { http_response_code(404); die(json_encode(['error' => 'No encontrado'])); }
        $pedido['items'] = $db->query("SELECT * FROM pedido_items WHERE pedido_id=$id")->fetch_all(MYSQLI_ASSOC);
        $pedido['historial'] = $db->query("SELECT * FROM pedido_estados WHERE pedido_id=$id ORDER BY created_at ASC")->fetch_all(MYSQLI_ASSOC);
        echo json_encode($pedido);
        break;

    case 'pedido_estado':
        $id = intval($_GET['id'] ?? 0);
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $estado = $data['estado'] ?? '';
        $stmt = $db->prepare("UPDATE pedidos SET estado=? WHERE id=?");
        $stmt->bind_param('si', $estado, $id);
        $stmt->execute();
        $es = $db->prepare("INSERT INTO pedido_estados (pedido_id,estado) VALUES (?,?)");
        $es->bind_param('is', $id, $estado);
        $es->execute();
        echo json_encode(['ok' => true]);
        break;

    case 'pedido_actualizar':
        $id = intval($_GET['id'] ?? 0);
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $obs = $data['observaciones'] ?? '';
        $facturas = $data['facturas'] ?? '';
        $stmt = $db->prepare("UPDATE pedidos SET observaciones=?,facturas=? WHERE id=?");
        $stmt->bind_param('ssi', $obs, $facturas, $id);
        $stmt->execute();
        echo json_encode(['ok' => true]);
        break;

    default:
        http_response_code(404);
        echo json_encode(['error' => 'Acción no encontrada']);
}
$db->close();
?>
