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
// producto de preventa. IDEmpresa se define en db.php (MANAGER_IDEMPRESA) —
// producción (3) desde el 31/08/2026, decisión de Mauricio una vez validada
// la integración (antes usaba TEST/sandbox=4 a propósito mientras se probaba;
// se dejó de usar porque esa copia no se autoactualiza y quedaba desfasada
// para productos nuevos). Solo lectura en todos los casos, nunca escribe.
define('MANAGER_LISTA_MAYORISTA', 3); // "Mayorista S" (real de Cindy, no la de Travel Blue — corregido 31/08/2026, ver cindy-preventa-catalogo.md)

// El token de Manager dura 60 min (ver Mi-Cerebro/conocimiento/manager2max.md).
// Cada request PHP es un proceso nuevo, así que sin esto un lote de N códigos
// (ej. "Importar por código") hacía N logins de más — uno por código, aunque
// el token del código anterior siguiera vigente. Se cachea en la tabla
// `config` (clave 'manager_token', valor JSON {token, exp}) para que todas
// las llamadas dentro de la ventana de 60 min reusen el mismo token.
function manager_login() {
    global $db;
    $r = $db->query("SELECT valor FROM config WHERE clave='manager_token' LIMIT 1");
    $row = $r ? $r->fetch_assoc() : null;
    if ($row) {
        $cache = json_decode($row['valor'], true);
        if ($cache && !empty($cache['token']) && ($cache['exp'] ?? 0) > time() + 60) {
            return $cache['token'];
        }
    }

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

    $token = $data['Token'];
    $valor = json_encode(['token' => $token, 'exp' => time() + 55 * 60]);
    $stmt = $db->prepare("INSERT INTO config (clave, valor) VALUES ('manager_token', ?) ON DUPLICATE KEY UPDATE valor=?");
    $stmt->bind_param('ss', $valor, $valor);
    $stmt->execute();

    return $token;
}

// Llamada cruda: devuelve Data tal cual la responde Manager, sin asumir el
// formato de listado paginado (DT.data). Necesaria para endpoints que no son
// GetDTxxx, como /Api/Image/GetImage (devuelve ImageContent directo en Data).
function manager_call_raw($token, $endpoint, $body) {
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
    return $data['Data'] ?? [];
}

// GetDTxxx (listados con paginación) — la mayoría de los endpoints de Manager.
function manager_call($token, $endpoint, $body) {
    $data = manager_call_raw($token, $endpoint, $body);
    return $data['DT']['data'] ?? [];
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

// Nuestro código interno = <dígito de rubro><código de proveedor> (ej.
// "1BP170"), y el dígito varía por artículo — no se puede reconstruir a
// mano. Manager sí guarda el código de proveedor tal cual en el campo
// CodigoProv, pero ese campo solo es filtrable en
// GetDTArticulosPrecioExistencia (no en GetDTArticulos) — confirmado en
// vivo 01/09/2026, GetDTArticulos tira "El nombre de columna 'CodigoProv'
// no es válido". Por eso el flujo es en 2 pasos: primero se resuelve la
// lista de códigos internos candidatos (genérico + variantes de color, si
// ya están cargadas) vía precio/existencia, después se completa cada uno
// con GetDTArticulos (descripción/rubro/marca).
// Devuelve un array de artículos: ['codigo','descripcion','categoria','marca','precio_mayorista','codigo_barras'].
function manager_buscar_por_codigo_proveedor($token, $codigoProv) {
    $precios = manager_call($token, '/Api/articulo/GetDTArticulosPrecioExistencia', [
        'DTRequest' => ['draw' => 1, 'order' => [], 'start' => 0, 'length' => 30],
        'DefinicionTablaFiltros' => false,
        'CalculaTotales' => false,
        'ListFilters' => manager_dict_filtros([
            'CodigoProv' => manager_filtro_texto($codigoProv),
            'IDListaPrecio' => manager_filtro_numero(MANAGER_LISTA_MAYORISTA),
            'IDDeposito' => manager_filtro_numero(0),
            'IDCliente' => manager_filtro_numero(0),
            'IDProveedor' => manager_filtro_numero(0),
            'IDMonedaComprobante' => manager_filtro_numero(1),
            'FactorCotizacionMonCompMonLP' => manager_filtro_numero(1.0),
        ]),
    ]);
    $resultados = [];
    foreach ($precios as $p) {
        if (trim($p['CodigoProv'] ?? '') !== $codigoProv) continue;
        $codigo = trim($p['CodigoArticulo'] ?? '');
        if ($codigo === '' || isset($resultados[$codigo])) continue;
        $articulo = manager_buscar_por_codigo($token, $codigo);
        if (!$articulo) continue;
        $resultados[$codigo] = [
            'codigo' => $codigo,
            'descripcion' => trim($articulo['Descripcion'] ?? ''),
            'categoria' => trim($articulo['Rubro'] ?? ''),
            'marca' => trim($articulo['Marca'] ?? ''),
            'precio_mayorista' => round(floatval($p['PrecioFinalLP'] ?? 0), 2),
            'codigo_barras' => trim($articulo['CodigoAuxiliar'] ?? ''),
            // El "genérico" es el que no tiene el sufijo "-XXX" de color —
            // sirve de referencia (categoría/marca) cuando la variante
            // puntual todavía no está cargada.
            'es_generico' => strpos($codigo, '-') === false,
        ];
    }
    return array_values($resultados);
}

// Compara el texto de una variante ("BEIGE") contra la descripción de un
// artículo de Manager ("BOLSO DE LONA SICILIA CHIMOLA BEIGE") — sin
// acentos ni mayúsculas/minúsculas, para tolerar diferencias de tipeo.
function manager_texto_normalizado($s) {
    $s = mb_strtoupper(trim($s ?? ''), 'UTF-8');
    $s = strtr($s, ['Á'=>'A','É'=>'E','Í'=>'I','Ó'=>'O','Ú'=>'U','Ñ'=>'N','Ü'=>'U']);
    return $s;
}

// Sufijo para códigos provisorios de variante (ej. "-BEI" para BEIGE).
// Una sola palabra (caso más común): 3 letras de esa palabra, igual que
// siempre. Variantes de dos o más palabras: 2 letras de cada una de las
// primeras 2 palabras — NO la frase entera truncada ni solo la última
// palabra, porque ninguna de esas dos alternativas evita colisiones reales:
// "CRAB RED"/"CRAB CAMEL" truncados enteros colisionan en "CRA"; "SHELL
// PINK"/"HOLIDAY PINK" con "última palabra" colisionan en "PIN" (mismo
// color, distinto calificador). Verificado sin colisiones contra los 274
// renglones reales de Chimola SS 27 (bug real que perdió 5 variantes en la
// carga del 2026-09-02, ver nota de proyecto en el vault).
function manager_sufijo_variante($variante) {
    if ($variante === '') return '';
    $palabras = preg_split('/\s+/', trim($variante));
    if (count($palabras) === 1) {
        return '-' . mb_strtoupper(mb_substr(preg_replace('/[^A-Za-zÁÉÍÓÚÑ]/u', '', $palabras[0]), 0, 3), 'UTF-8');
    }
    $sufijo = '';
    foreach (array_slice($palabras, 0, 2) as $p) {
        $sufijo .= mb_substr(preg_replace('/[^A-Za-zÁÉÍÓÚÑ]/u', '', $p), 0, 2);
    }
    return '-' . mb_strtoupper($sufijo, 'UTF-8');
}

// Devuelve el Base64 crudo (sin decodificar) de la foto principal (Orden=1)
// de un artículo en Manager, o null si no existe. Solo-lectura
// (GetDTArticulosImagenes/GetImage) — compartida entre "manager_imagen_producto"
// (guarda directo a disco) y el lookup de "Importar por código" (guarda en
// memoria del navegador para el preview, recién se escribe a disco al confirmar).
function manager_buscar_imagen_base64($token, $codigo) {
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
    if (!$principal) return null;
    $imgResp = manager_call_raw($token, '/Api/Image/GetImage', ['ImageFullPath' => $principal['PasoImagen']]);
    return $imgResp['ImageContent'] ?? null;
}

// Decodifica un Base64 de imagen, lo redimensiona a cuadro blanco 800x800
// (mismo criterio que el resto del catálogo) y lo guarda en imgs/<codigo>.jpeg.
// Devuelve la ruta relativa guardada, o null si el Base64 es ilegible.
function guardar_imagen_base64($base64, $codigo) {
    $bytes = base64_decode($base64);
    $src = @imagecreatefromstring($bytes);
    if (!$src) return null;
    $dst = redimensionar_a_cuadro($src, 800, 800);
    if (!is_dir(__DIR__ . '/imgs')) mkdir(__DIR__ . '/imgs', 0755, true);
    $filename = str_replace('/', '_', $codigo) . '.jpeg';
    imagejpeg($dst, __DIR__ . '/imgs/' . $filename, 85);
    imagedestroy($src);
    imagedestroy($dst);
    return 'imgs/' . $filename;
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

    $colCheck = $db->query("SHOW COLUMNS FROM productos LIKE 'marca'");
    if ($colCheck && $colCheck->num_rows === 0) {
        $db->query("ALTER TABLE productos ADD COLUMN marca VARCHAR(100) DEFAULT NULL");
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

    // Por defecto NO se muestra "Quedan N disponibles" en el catálogo público
    // (decisión de Mauricio) — cada preventa lo habilita a propósito.
    $colCheck = $db->query("SHOW COLUMNS FROM preventas LIKE 'mostrar_stock'");
    if ($colCheck && $colCheck->num_rows === 0) {
        $db->query("ALTER TABLE preventas ADD COLUMN mostrar_stock TINYINT NOT NULL DEFAULT 0");
    }

    $colCheck = $db->query("SHOW COLUMNS FROM preventas LIKE 'detalle'");
    if ($colCheck && $colCheck->num_rows === 0) {
        $db->query("ALTER TABLE preventas ADD COLUMN detalle VARCHAR(300) DEFAULT NULL");
    }

    // Alternativa a subir una imagen: un color liso de fondo. Si hay
    // imagen, gana la imagen (color_portada queda guardado igual, por si
    // se saca la imagen después no hay que volver a elegir color).
    $colCheck = $db->query("SHOW COLUMNS FROM preventas LIKE 'color_portada'");
    if ($colCheck && $colCheck->num_rows === 0) {
        $db->query("ALTER TABLE preventas ADD COLUMN color_portada VARCHAR(7) DEFAULT NULL");
    }

    $colCheck = $db->query("SHOW COLUMNS FROM productos LIKE 'preventa_id'");
    if ($colCheck && $colCheck->num_rows === 0) {
        $db->query("ALTER TABLE productos ADD COLUMN preventa_id INT DEFAULT NULL");
        $db->query("ALTER TABLE productos ADD INDEX idx_preventa_id (preventa_id)");
    }

    // "Ingresó": atributo del PRODUCTO (no del pedido) — indica si esa
    // mercadería ya llegó físicamente al local. Se usa para segmentar la
    // impresión de pedidos, y al ser del producto se refleja igual en
    // TODOS los pedidos pendientes que lo incluyan, no solo en uno.
    // Reemplaza al intento anterior (pedido_items.ingreso, por ítem de
    // pedido) — esa columna queda sin usar, no se borra por prolijidad.
    $colCheck = $db->query("SHOW COLUMNS FROM productos LIKE 'ingreso'");
    if ($colCheck && $colCheck->num_rows === 0) {
        $db->query("ALTER TABLE productos ADD COLUMN ingreso TINYINT(1) NOT NULL DEFAULT 0");
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

    // VARCHAR(255) se quedaba corto para cachear el token de Manager (JWT de
    // ~670 caracteres) — el INSERT fallaba en silencio y nunca cacheaba nada.
    $colCheck = $db->query("SHOW COLUMNS FROM config LIKE 'valor'");
    $colInfo = $colCheck ? $colCheck->fetch_assoc() : null;
    if ($colInfo && stripos($colInfo['Type'], 'varchar') !== false) {
        $db->query("ALTER TABLE config MODIFY valor TEXT NOT NULL");
    }

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

    // Token random (no secuencial, a diferencia del id autoincremental) para
    // el link público de solo lectura (pedido.php) — así se puede compartir
    // sin exponer el patrón de IDs ni depender de sesión de admin.
    $colCheck = $db->query("SHOW COLUMNS FROM pedidos LIKE 'token_publico'");
    if ($colCheck && $colCheck->num_rows === 0) {
        $db->query("ALTER TABLE pedidos ADD COLUMN token_publico VARCHAR(64) DEFAULT NULL, ADD UNIQUE KEY uq_token_publico (token_publico)");
    }

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

    // Snapshot de la cantidad elegida por color (JSON {"Negro":2,"Blanco":1}).
    // El stock sigue siendo del artículo principal, no por color — esto es
    // solo para saber qué preparar. NULL si el producto no maneja colores.
    $colCheck = $db->query("SHOW COLUMNS FROM pedido_items LIKE 'colores_detalle'");
    if ($colCheck && $colCheck->num_rows === 0) {
        $db->query("ALTER TABLE pedido_items ADD COLUMN colores_detalle TEXT DEFAULT NULL");
    }

    // "Ingresó": la mercadería de ESTE ítem ya llegó físicamente al local —
    // toggle manual por producto, para poder discriminar al imprimir el
    // pedido qué artículos ya están y cuáles todavía se están esperando.
    $colCheck = $db->query("SHOW COLUMNS FROM pedido_items LIKE 'ingreso'");
    if ($colCheck && $colCheck->num_rows === 0) {
        $db->query("ALTER TABLE pedido_items ADD COLUMN ingreso TINYINT(1) NOT NULL DEFAULT 0");
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

// Interpreta la columna INGRESO de un Excel: "SI"/"SÍ"/"S"/"YES"/"1"/"TRUE"
// (case-insensitive) es Sí, cualquier otra cosa (incluido vacío) es No.
function parse_ingreso_valor($v) {
    $v = mb_strtoupper(trim((string)($v ?? '')), 'UTF-8');
    return in_array($v, ['SI', 'SÍ', 'S', 'YES', 'Y', '1', 'TRUE', 'X'], true) ? 1 : 0;
}

function normalizarTel($tel) {
    $tel = preg_replace('/[^0-9]/', '', $tel);
    if (substr($tel, 0, 2) === '54') $tel = substr($tel, 2);
    if (substr($tel, 0, 1) === '0') $tel = substr($tel, 1);
    if (strlen($tel) > 10 && substr($tel, 3, 2) === '15') $tel = substr($tel, 0, 3) . substr($tel, 5);
    return '54' . $tel;
}

// ── Aviso automático de pedido nuevo por WhatsApp (UltraMsg) ────────────────
// Reemplaza la dependencia de que el cliente abra su propio WhatsApp y toque
// enviar (wa.me) — el aviso a Cindy ahora lo dispara el servidor. Best-effort:
// si falla (sin credenciales, red caída, etc.) nunca debe romper la creación
// del pedido — se llama siempre envuelto en try/catch desde pedido_crear.
function enviarUltraMsg($db, $to, $body) {
    $cfg = $db->query("SELECT clave, valor FROM config WHERE clave IN ('ultramsg_instance','ultramsg_token')");
    $creds = [];
    while ($row = $cfg->fetch_assoc()) $creds[$row['clave']] = $row['valor'];
    if (empty($creds['ultramsg_instance']) || empty($creds['ultramsg_token'])) {
        return ['ok' => false, 'error' => 'UltraMsg no configurado'];
    }
    $endpoint = 'https://api.ultramsg.com/' . $creds['ultramsg_instance'] . '/messages/chat';
    $payload = http_build_query(['token' => $creds['ultramsg_token'], 'to' => $to, 'body' => $body]);
    $ctx = stream_context_create(['http' => [
        'method' => 'POST',
        'header' => "Content-Type: application/x-www-form-urlencoded\r\n",
        'content' => $payload,
        'timeout' => 15,
        'ignore_errors' => true,
    ]]);
    $resp = @file_get_contents($endpoint, false, $ctx);
    if ($resp === false) return ['ok' => false, 'error' => 'Sin respuesta de UltraMsg'];
    $json = json_decode($resp, true);
    if (isset($json['sent']) && ($json['sent'] === 'true' || $json['sent'] === true)) return ['ok' => true];
    return ['ok' => false, 'error' => $resp];
}

// Porta a PHP el formato de mensaje que antes se armaba en catalogo.js
// (sendWA) para poder mandarlo server-side. Mismo formato de emojis/secciones
// que ya conocen Cindy y sus clientes — no cambiar el orden sin avisar.
function armarMensajeWA($clienteData, $transporte, $obs, $itemsProcesados, $total, $urlPublica) {
    $fecha = date('d/m/Y');
    $msg = "🛍️ *PEDIDO PREVENTA*\n━━━━━━━━━━━━━━━━━━━━━━\n";
    $msg .= "👤 *Cliente:* " . $clienteData['nombre'] . "\n";
    $msg .= "📞 *Tel:* +" . $clienteData['telefono'] . "\n";
    if (!empty($clienteData['cuit_dni'])) $msg .= "🪪 *CUIT/DNI:* " . $clienteData['cuit_dni'] . "\n";
    if (!empty($clienteData['domicilio'])) {
        $msg .= "📍 *Envío:* " . $clienteData['domicilio'] . ", " . ($clienteData['localidad'] ?? '') .
            " (" . ($clienteData['cp'] ?? '') . ") " . ($clienteData['provincia'] ?? '') . "\n";
    }
    if (!empty($transporte)) $msg .= "🚚 *Transporte:* " . $transporte . "\n";
    if (!empty($obs)) $msg .= "📝 *Notas:* " . $obs . "\n";
    $msg .= "📅 *Fecha:* " . $fecha . "\n━━━━━━━━━━━━━━━━━━━━━━\n\n";

    $grupos = []; $orden = [];
    foreach ($itemsProcesados as $item) {
        $g = $item['preventa_nombre'] ?: 'Catálogo general';
        if (!isset($grupos[$g])) { $grupos[$g] = []; $orden[] = $g; }
        $grupos[$g][] = $item;
    }
    $hayListaEspera = false;
    foreach ($orden as $nombreGrupo) {
        $msg .= "🏷️ *" . $nombreGrupo . "*\n";
        foreach ($grupos[$nombreGrupo] as $item) {
            $esperaTag = $item['en_lista_espera'] ? " ⏳ *A CONFIRMAR STOCK*" : "";
            if ($item['en_lista_espera']) $hayListaEspera = true;
            $coloresTxt = "";
            if (!empty($item['colores_detalle'])) {
                $cobj = json_decode($item['colores_detalle'], true);
                if (is_array($cobj)) {
                    $partes = [];
                    foreach ($cobj as $k => $v) $partes[] = $k . ': ' . $v;
                    $coloresTxt = "\n  " . implode(' · ', $partes);
                }
            }
            $msg .= "• *" . $item['descripcion'] . "*\n  Cód: " . $item['codigo'] .
                "  |  Cant: " . $item['cantidad'] . "  |  $" . number_format($item['subtotal'], 0, ',', '.') .
                " + IVA" . $esperaTag . $coloresTxt . "\n\n";
        }
    }
    $msg .= "━━━━━━━━━━━━━━━━━━━━━━\n*TOTAL: $" . number_format($total, 0, ',', '.') . " + IVA*\n";
    if ($hayListaEspera) {
        $msg .= "\n⏳ Los ítems marcados \"A CONFIRMAR STOCK\" superan el stock de preventa cargado — quedan en lista de espera hasta confirmar disponibilidad.\n";
    }
    $msg .= "━━━━━━━━━━━━━━━━━━━━━━\n_Pedido generado desde el catálogo de preventa_";
    if (!empty($urlPublica)) $msg .= "\n🔗 Ver detalle: " . $urlPublica;
    return $msg;
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
        $sql = "SELECT p.*, COALESCE(c.orden, 0) as cat_orden, pv.nombre as preventa_nombre, pv.detalle as preventa_detalle, pv.activa as preventa_activa, pv.imagen as preventa_imagen, pv.color_portada as preventa_color_portada, pv.orden as preventa_orden, pv.mostrar_stock as preventa_mostrar_stock, UNIX_TIMESTAMP(pv.updated_at) as preventa_imagen_v
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
        $marca = isset($data['marca']) && $data['marca'] !== '' ? trim($data['marca']) : null;
        // El stock nunca se clampea a 0 — un negativo es información real
        // (sobreventa/backorder), no un error a esconder.
        $stockInicial = intval($data['stock_preventa'] ?? 0);
        $preventaId = isset($data['preventa_id']) && $data['preventa_id'] !== '' ? intval($data['preventa_id']) : null;
        $ingreso = !empty($data['ingreso']) ? 1 : 0;
        $stmt = $db->prepare("INSERT INTO productos (codigo,descripcion,categoria,marca,precio_mayorista,foto,estado,orden,multiplo,codigo_barras,stock_preventa,stock_preventa_inicial,preventa_id,ingreso) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
        $stmt->bind_param('ssssdssiisiiii', $data['codigo'], $data['descripcion'], $data['categoria'], $marca, $data['precio_mayorista'], $data['foto'], $data['estado'], $orden, $multiplo, $codigoBarras, $stockInicial, $stockInicial, $preventaId, $ingreso);
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
        $marca = isset($data['marca']) && $data['marca'] !== '' ? trim($data['marca']) : null;
        $ordenActual = $db->query("SELECT orden FROM productos WHERE id=$id")->fetch_assoc();
        $orden = isset($data['orden']) && $data['orden'] !== '' ? intval($data['orden']) : ($ordenActual['orden'] ?? 0);
        // stock_preventa se puede corregir a mano desde el formulario de edición
        // (para sumar stock de verdad, ver el endpoint "stock_agregar", que
        // además lleva el acumulado en stock_preventa_inicial).
        $stock = intval($data['stock_preventa'] ?? 0);
        $preventaId = isset($data['preventa_id']) && $data['preventa_id'] !== '' ? intval($data['preventa_id']) : null;
        $ingreso = !empty($data['ingreso']) ? 1 : 0;
        $stmt = $db->prepare("UPDATE productos SET codigo=?,descripcion=?,categoria=?,marca=?,precio_mayorista=?,foto=?,estado=?,orden=?,multiplo=?,codigo_barras=?,stock_preventa=?,preventa_id=?,ingreso=?,updated_at=NOW() WHERE id=?");
        $stmt->bind_param('ssssdssiisiiii', $data['codigo'], $data['descripcion'], $data['categoria'], $marca, $data['precio_mayorista'], $data['foto'], $data['estado'], $orden, $multiplo, $codigoBarras, $stock, $preventaId, $ingreso, $id);
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
            $stock = intval($p['STOCK_PREVENTA'] ?? 0);
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
        // Cómo se aplica STOCK_PREVENTA a productos que YA existen: "reemplazar"
        // deja el número exacto de la fila; cualquier otro valor (o ausente) es
        // "sumar", que suma (o resta, con negativos) al stock actual — mismo
        // criterio que "Sumar stock" en el admin, no pisa en silencio lo ya
        // vendido. Elegido una sola vez por importación, no por fila.
        $stockMode = ($data['stock_mode'] ?? 'sumar') === 'reemplazar' ? 'reemplazar' : 'sumar';
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

            $chk = $db->prepare("SELECT codigo,descripcion,categoria,marca,precio_mayorista,multiplo,estado,codigo_barras,stock_preventa,stock_preventa_inicial FROM productos WHERE codigo=?");
            $chk->bind_param('s', $codigo); $chk->execute();
            $existing = $chk->get_result()->fetch_assoc();

            if ($existing) {
                // Actualiza datos del producto, incluyendo stock_preventa si la
                // fila trae STOCK_PREVENTA (ver $stockMode arriba).
                $prevJson = json_encode($existing, JSON_UNESCAPED_UNICODE);
                $snapStmt = $db->prepare("INSERT INTO import_snapshots (import_id, codigo, accion, datos_anteriores) VALUES (?,?,'updated',?)");
                $snapStmt->bind_param('sss', $import_id, $codigo, $prevJson);
                $snapStmt->execute();

                $sets = []; $params = []; $types = '';
                if (isset($p['DESCRIPCION'])    && $p['DESCRIPCION']    !== '') { $sets[] = 'descripcion=?';      $params[] = trim($p['DESCRIPCION']);           $types .= 's'; }
                if (isset($p['CATEGORIA'])      && $p['CATEGORIA']      !== '') { $sets[] = 'categoria=?';        $params[] = trim($p['CATEGORIA']);             $types .= 's'; }
                if (isset($p['MARCA'])          && $p['MARCA']          !== '') { $sets[] = 'marca=?';            $params[] = trim($p['MARCA']);                 $types .= 's'; }
                if (isset($p['PRECIO_MAYORISTA']) && $p['PRECIO_MAYORISTA'] !== '') { $sets[] = 'precio_mayorista=?'; $params[] = floatval($p['PRECIO_MAYORISTA']); $types .= 'd'; }
                if (isset($p['MULTIPLO'])       && $p['MULTIPLO']       !== '') { $sets[] = 'multiplo=?';         $params[] = max(1, intval($p['MULTIPLO']));    $types .= 'i'; }
                if (isset($p['STOCK_PREVENTA'])  && $p['STOCK_PREVENTA']  !== '' && is_numeric($p['STOCK_PREVENTA'])) {
                    // El stock nunca se clampea a 0 — un negativo (sobreventa/
                    // backorder) es información real, no un error a esconder.
                    $curStock   = intval($existing['stock_preventa'] ?? 0);
                    $curInicial = intval($existing['stock_preventa_inicial'] ?? 0);
                    if ($stockMode === 'reemplazar') {
                        $newStock = intval($p['STOCK_PREVENTA']);
                        $delta = $newStock - $curStock;
                    } else {
                        $delta = intval($p['STOCK_PREVENTA']);
                        $newStock = $curStock + $delta;
                    }
                    $newInicial = max($newStock, $curInicial + $delta);
                    $sets[] = 'stock_preventa=?';         $params[] = $newStock;   $types .= 'i';
                    $sets[] = 'stock_preventa_inicial=?'; $params[] = $newInicial; $types .= 'i';
                }
                if (isset($p['ESTADO'])         && $p['ESTADO']         !== '') { $sets[] = 'estado=?';           $params[] = strtoupper(trim($p['ESTADO']));    $types .= 's'; }
                if (isset($p['CODIGO_BARRAS'])  && $p['CODIGO_BARRAS']  !== '') { $sets[] = 'codigo_barras=?';    $params[] = trim($p['CODIGO_BARRAS']);          $types .= 's'; }
                if (isset($p['PREVENTA'])       && $p['PREVENTA']       !== '') { $sets[] = 'preventa_id=?';      $params[] = resolver_preventa_id($db, $p['PREVENTA']); $types .= 'i'; }
                if (isset($p['INGRESO'])        && $p['INGRESO']        !== '') { $sets[] = 'ingreso=?';          $params[] = parse_ingreso_valor($p['INGRESO']); $types .= 'i'; }
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
                $marca  = isset($p['MARCA']) && $p['MARCA'] !== '' ? trim($p['MARCA']) : null;
                $may    = floatval($p['PRECIO_MAYORISTA'] ?? 0);
                $estado = strtoupper(trim($p['ESTADO'] ?? 'DISPONIBLE'));
                $cb     = isset($p['CODIGO_BARRAS']) && $p['CODIGO_BARRAS'] !== '' ? trim($p['CODIGO_BARRAS']) : null;
                $stock  = intval($p['STOCK_PREVENTA'] ?? 0);
                $preventaId = resolver_preventa_id($db, $p['PREVENTA'] ?? '');
                $ingreso = parse_ingreso_valor($p['INGRESO'] ?? '');
                if (!$desc || !$cat) { $errors[] = ['codigo' => $codigo, 'motivo' => 'DESCRIPCION y CATEGORIA obligatorias para producto nuevo']; continue; }
                $o = 0;
                $multiplo = isset($p['MULTIPLO']) && $p['MULTIPLO'] !== '' ? max(1, intval($p['MULTIPLO'])) : 1;
                $stmt = $db->prepare("INSERT INTO productos (codigo,descripcion,categoria,marca,precio_mayorista,estado,orden,multiplo,codigo_barras,stock_preventa,stock_preventa_inicial,preventa_id,ingreso) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
                $stmt->bind_param('ssssdsiisiiii', $codigo, $desc, $cat, $marca, $may, $estado, $o, $multiplo, $cb, $stock, $stock, $preventaId, $ingreso);
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
        $stmt = $db->prepare("SELECT codigo, descripcion, categoria, marca, precio_mayorista, multiplo, estado, codigo_barras, stock_preventa, ingreso FROM productos WHERE codigo IN ($ph)");
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
                    $desc     = $prev['descripcion']     ?? '';
                    $cat      = $prev['categoria']       ?? '';
                    $marca    = isset($prev['marca']) && $prev['marca'] !== null ? strval($prev['marca']) : null;
                    $pmay     = floatval($prev['precio_mayorista'] ?? 0);
                    $multiplo = max(1, intval($prev['multiplo'] ?? 1));
                    $est      = $prev['estado']          ?? 'DISPONIBLE';
                    $cb       = isset($prev['codigo_barras']) && $prev['codigo_barras'] !== null ? strval($prev['codigo_barras']) : null;
                    $stock    = intval($prev['stock_preventa'] ?? 0);
                    $stockIni = intval($prev['stock_preventa_inicial'] ?? 0);
                    $cod      = $row['codigo'];

                    $stmt = $db->prepare("UPDATE productos SET descripcion=?,categoria=?,marca=?,precio_mayorista=?,multiplo=?,estado=?,codigo_barras=?,stock_preventa=?,stock_preventa_inicial=? WHERE codigo=?");
                    if (!$stmt) throw new Exception("prepare UPDATE falló para " . $cod . ": " . $db->error);
                    $stmt->bind_param('sssdissiis', $desc, $cat, $marca, $pmay, $multiplo, $est, $cb, $stock, $stockIni, $cod);
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
        $colorPortada = isset($data['color_portada']) && $data['color_portada'] !== '' ? trim($data['color_portada']) : null;
        $activa = !empty($data['activa']) ? 1 : 0;
        $mostrarStock = !empty($data['mostrar_stock']) ? 1 : 0;
        $orden = intval($data['orden'] ?? 0);
        if (!$nombre) { http_response_code(400); die(json_encode(['error' => 'Nombre requerido'])); }
        $stmt = $db->prepare("INSERT INTO preventas (nombre, detalle, imagen, color_portada, activa, mostrar_stock, orden) VALUES (?, ?, ?, ?, ?, ?, ?)");
        $stmt->bind_param('ssssiii', $nombre, $detalle, $imagen, $colorPortada, $activa, $mostrarStock, $orden);
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
        $mostrarStock = !empty($data['mostrar_stock']) ? 1 : 0;
        $colorPortada = isset($data['color_portada']) && $data['color_portada'] !== '' ? trim($data['color_portada']) : null;
        if (isset($data['imagen'])) {
            $imagen = $data['imagen'] !== '' ? trim($data['imagen']) : null;
            // El nombre de archivo de una portada nueva es único por subida
            // (ver upload.php) — si esto reemplaza una portada anterior,
            // borrar el archivo viejo para no acumular huérfanos en el server.
            $viejo = null;
            $prevImg = $db->prepare("SELECT imagen FROM preventas WHERE id=?");
            $prevImg->bind_param('i', $id);
            $prevImg->execute();
            $row = $prevImg->get_result()->fetch_assoc();
            if ($row && $row['imagen'] && $row['imagen'] !== $imagen) $viejo = $row['imagen'];
            $stmt = $db->prepare("UPDATE preventas SET nombre=?, detalle=?, imagen=?, color_portada=?, activa=?, mostrar_stock=? WHERE id=?");
            $stmt->bind_param('ssssiii', $nombre, $detalle, $imagen, $colorPortada, $activa, $mostrarStock, $id);
        } else {
            $stmt = $db->prepare("UPDATE preventas SET nombre=?, detalle=?, color_portada=?, activa=?, mostrar_stock=? WHERE id=?");
            $stmt->bind_param('sssiii', $nombre, $detalle, $colorPortada, $activa, $mostrarStock, $id);
        }
        if ($stmt->execute()) {
            if (!empty($viejo) && strpos($viejo, 'http') !== 0) {
                $viejoPath = __DIR__ . '/' . $viejo;
                if (is_file($viejoPath)) @unlink($viejoPath);
            }
            echo json_encode(['ok' => true]);
        } else { http_response_code(400); echo json_encode(['error' => $db->error]); }
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
            $base64 = manager_buscar_imagen_base64($token, $codigo);
            if (!$base64) { echo json_encode(['ok' => true, 'encontrada' => false]); break; }

            $foto = guardar_imagen_base64($base64, $codigo);
            if (!$foto) { echo json_encode(['ok' => true, 'encontrada' => false, 'error' => 'Imagen de Manager ilegible']); break; }

            $stmt = $db->prepare("UPDATE productos SET foto=? WHERE codigo=?");
            $stmt->bind_param('ss', $foto, $codigo);
            $stmt->execute();

            echo json_encode(['ok' => true, 'encontrada' => true, 'foto' => $foto]);
        } catch (Exception $e) {
            http_response_code(500);
            echo json_encode(['error' => $e->getMessage()]);
        }
        break;

    // ── IMPORTAR POR CÓDIGO (autocompletar desde Manager) ───────────────────────
    // Paso 1 (preview, uno por uno): busca en Manager sin escribir nada en la
    // base ni en disco — la foto se trae como Base64 a memoria del navegador,
    // recién se guarda a disco cuando se confirma el lote completo.
    case 'manager_lookup_producto':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $codigo = trim($data['codigo'] ?? '');
        // Variante/descripción/precio: opcionales, vienen de pegar varias
        // columnas de una planilla de proveedor (ver "Importar por código").
        // Sirven para el caso preventa: el código pegado es el del
        // proveedor, no el interno, y puede que ni siquiera exista todavía
        // en Manager (lo más común) — ahí se usan como fallback.
        $variante = trim($data['variante'] ?? '');
        $descFallback = trim($data['descripcion_fallback'] ?? '');
        $precioFallback = isset($data['precio_fallback']) && $data['precio_fallback'] !== '' ? floatval($data['precio_fallback']) : null;
        if (!$codigo) { http_response_code(400); die(json_encode(['error' => 'código requerido'])); }
        try {
            $token = manager_login();

            // Paso 1: ¿el código pegado ES YA el código interno real?
            // (cubre el uso de siempre: códigos propios, no de proveedor)
            $articulo = manager_buscar_por_codigo($token, $codigo);
            $codigoFinal = $codigo;
            $origen = 'directo';
            $imagenBase64 = null;

            if ($articulo) {
                $categoria = trim($articulo['Rubro'] ?? '');
                $marca = trim($articulo['Marca'] ?? '');
                $codigoBarras = trim($articulo['CodigoAuxiliar'] ?? '');
                $precio = manager_precio_por_codigo($token, $codigo, MANAGER_LISTA_MAYORISTA);
                $descripcion = trim($articulo['Descripcion'] ?? '');
                $imagenBase64 = manager_buscar_imagen_base64($token, $codigo);
            } else {
                // Paso 2: no es un código interno conocido — probar como
                // código de proveedor (busca el genérico + variantes de
                // color que ya estén cargadas, si las hay).
                $candidatos = manager_buscar_por_codigo_proveedor($token, $codigo);
                $generico = null;
                foreach ($candidatos as $c) { if ($c['es_generico']) $generico = $c; }

                // Match de variante: primero se busca IGUALDAD exacta entre
                // lo pedido y el color real (la descripción del candidato
                // menos la base genérica en común) — evita falsos positivos
                // como "BLUE" matcheando contra "... DEEP BLUE" por ser
                // substring (bug real, Chimola SS 27, 2026-09-02: perdió la
                // variante BLUE de un artículo que también tenía DEEP BLUE).
                // Si no hay genérico contra el cual aislar el color, se cae
                // al substring de siempre como último recurso.
                $match = null;
                if ($variante !== '' && $generico) {
                    $varNorm  = manager_texto_normalizado($variante);
                    $baseNorm = manager_texto_normalizado($generico['descripcion']);
                    foreach ($candidatos as $c) {
                        if ($c['es_generico']) continue;
                        $descNorm = manager_texto_normalizado($c['descripcion']);
                        $colorSolo = trim(str_replace($baseNorm, '', $descNorm));
                        if ($colorSolo === $varNorm) { $match = $c; break; }
                    }
                }
                if (!$match && $variante !== '') {
                    foreach ($candidatos as $c) {
                        if ($c['es_generico']) continue;
                        if (strpos(manager_texto_normalizado($c['descripcion']), manager_texto_normalizado($variante)) !== false) {
                            $match = $c;
                            break;
                        }
                    }
                }
                if (!$match && $variante === '' && $generico) $match = $generico;

                if ($match) {
                    // Variante ya cargada en Manager (o sin variante pedida,
                    // se usó el genérico) — datos 100% reales.
                    $codigoFinal = $match['codigo'];
                    $categoria = $match['categoria'];
                    $marca = $match['marca'];
                    $codigoBarras = $match['codigo_barras'];
                    $precio = $match['precio_mayorista'];
                    $descripcion = $match['descripcion'];
                    $origen = 'manager_variante';
                    $imagenBase64 = manager_buscar_imagen_base64($token, $codigoFinal);
                } elseif ($generico) {
                    // El artículo base existe pero esta variante de color
                    // puntual todavía no — se arma un código provisorio
                    // (mismo criterio de sufijo que usa Manager) para no
                    // pisar otro color del mismo artículo.
                    $sufijo = manager_sufijo_variante($variante);
                    $codigoFinal = $codigo . $sufijo;
                    $categoria = $generico['categoria'];
                    $marca = $generico['marca'];
                    $codigoBarras = null;
                    $precio = $generico['precio_mayorista'];
                    $descBase = $descFallback !== '' ? $descFallback : $generico['descripcion'];
                    $descripcion = trim($descBase . ($variante !== '' ? ' ' . mb_strtoupper($variante, 'UTF-8') : ''));
                    $origen = 'manager_generico_sin_variante';
                } elseif ($descFallback !== '') {
                    // Nada en Manager todavía (lo más común en preventa) —
                    // se usan los datos que vinieron pegados de la planilla.
                    $sufijo = manager_sufijo_variante($variante);
                    $codigoFinal = $codigo . $sufijo;
                    $categoria = '';
                    $marca = null;
                    $codigoBarras = null;
                    $precio = $precioFallback;
                    $descripcion = $descFallback . ($variante !== '' ? ' ' . mb_strtoupper($variante, 'UTF-8') : '');
                    $origen = 'planilla';
                } else {
                    echo json_encode(['ok' => true, 'codigo' => $codigo, 'encontrado' => false]);
                    break;
                }
            }

            $chk = $db->prepare("SELECT codigo FROM productos WHERE codigo=?");
            $chk->bind_param('s', $codigoFinal);
            $chk->execute();
            $existe = (bool) $chk->get_result()->fetch_assoc();

            echo json_encode([
                'ok' => true,
                'codigo' => $codigoFinal,
                'codigo_original' => $codigo,
                'origen' => $origen,
                'encontrado' => true,
                'existe' => $existe,
                'descripcion' => $descripcion,
                'categoria' => $categoria !== '' ? mb_strtoupper($categoria, 'UTF-8') : '',
                'marca' => $marca !== '' ? $marca : null,
                'precio_mayorista' => $precio,
                'codigo_barras' => $codigoBarras !== '' ? $codigoBarras : null,
                'imagen_base64' => $imagenBase64,
            ]);
        } catch (Exception $e) {
            http_response_code(500);
            echo json_encode(['error' => $e->getMessage()]);
        }
        break;

    // Paso 2 (confirmar): recibe las filas YA buscadas en el paso anterior
    // (sin volver a pegarle a Manager) y escribe todo de una — altas,
    // actualizaciones, categorías nuevas si el Rubro no existe, imágenes a
    // disco, y la preventa elegida asignada a todo el lote.
    case 'manager_importar_lote':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $preventaId = intval($data['preventa_id'] ?? 0);
        if (!$preventaId) { http_response_code(400); die(json_encode(['error' => 'preventa_id requerido'])); }
        $filas = $data['productos'] ?? [];
        if (!$filas) { http_response_code(400); die(json_encode(['error' => 'Sin productos'])); }

        $creados = 0; $actualizados = 0; $errores = [];
        foreach ($filas as $p) {
            $codigo = trim($p['codigo'] ?? '');
            $descripcion = trim($p['descripcion'] ?? '');
            $categoria = trim($p['categoria'] ?? '');
            if (!$codigo || !$descripcion || !$categoria) { $errores[] = ['codigo' => $codigo ?: '(vacío)', 'motivo' => 'Faltan datos obligatorios']; continue; }

            // Crea la categoría sola si el Rubro de Manager no existe todavía
            // (mismo comportamiento que el alta individual "Buscar en Manager").
            $catCheck = $db->prepare("SELECT id FROM categorias WHERE nombre=?");
            $catCheck->bind_param('s', $categoria);
            $catCheck->execute();
            if (!$catCheck->get_result()->fetch_assoc()) {
                $cCount = $db->query("SELECT COUNT(*) as n FROM categorias")->fetch_assoc()['n'];
                $insCat = $db->prepare("INSERT IGNORE INTO categorias (nombre, orden) VALUES (?, ?)");
                $insCat->bind_param('si', $categoria, $cCount);
                $insCat->execute();
            }

            $precio = floatval($p['precio_mayorista'] ?? 0);
            $codigoBarras = isset($p['codigo_barras']) && $p['codigo_barras'] !== '' ? trim($p['codigo_barras']) : null;
            $marca = isset($p['marca']) && $p['marca'] !== '' ? trim($p['marca']) : null;
            $foto = !empty($p['imagen_base64']) ? guardar_imagen_base64($p['imagen_base64'], $codigo) : null;

            $chk = $db->prepare("SELECT id FROM productos WHERE codigo=?");
            $chk->bind_param('s', $codigo);
            $chk->execute();
            $existing = $chk->get_result()->fetch_assoc();

            if ($existing) {
                if ($foto) {
                    $stmt = $db->prepare("UPDATE productos SET descripcion=?,categoria=?,marca=?,precio_mayorista=?,codigo_barras=?,foto=?,preventa_id=?,updated_at=NOW() WHERE codigo=?");
                    $stmt->bind_param('sssdssis', $descripcion, $categoria, $marca, $precio, $codigoBarras, $foto, $preventaId, $codigo);
                } else {
                    $stmt = $db->prepare("UPDATE productos SET descripcion=?,categoria=?,marca=?,precio_mayorista=?,codigo_barras=?,preventa_id=?,updated_at=NOW() WHERE codigo=?");
                    $stmt->bind_param('sssdsis', $descripcion, $categoria, $marca, $precio, $codigoBarras, $preventaId, $codigo);
                }
                if ($stmt->execute()) $actualizados++;
                else $errores[] = ['codigo' => $codigo, 'motivo' => $db->error];
            } else {
                // Stock inicial opcional (ej. Chimola: cantidad por color ya
                // sabida de antemano, viene de la planilla del proveedor).
                // La mayoría de las marcas no lo traen y arrancan en 0.
                $estado = 'DISPONIBLE'; $orden = 0; $multiplo = 1;
                $stock = intval($p['stock_inicial'] ?? 0);
                $stmt = $db->prepare("INSERT INTO productos (codigo,descripcion,categoria,marca,precio_mayorista,codigo_barras,foto,estado,orden,multiplo,stock_preventa,stock_preventa_inicial,preventa_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
                $stmt->bind_param('ssssdsssiiiii', $codigo, $descripcion, $categoria, $marca, $precio, $codigoBarras, $foto, $estado, $orden, $multiplo, $stock, $stock, $preventaId);
                if ($stmt->execute()) $creados++;
                else $errores[] = ['codigo' => $codigo, 'motivo' => $db->error];
            }
        }
        echo json_encode(['ok' => true, 'creados' => $creados, 'actualizados' => $actualizados, 'errores' => $errores]);
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

    // Variante autenticada de config_get: a diferencia del público (whitelist
    // fija a 'whatsapp'), esta devuelve todo lo guardado en config — la usa
    // el admin para mostrar valores ya guardados de UltraMsg, que nunca deben
    // quedar expuestos por el endpoint público.
    case 'config_get_admin':
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $r = $db->query("SELECT clave, valor FROM config");
        $cfg = [];
        while ($row = $r->fetch_assoc()) $cfg[$row['clave']] = $row['valor'];
        echo json_encode($cfg);
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
                // Detalle por color (opcional): se guarda tal cual lo mandó el
                // cliente, solo para picking — el stock/lista de espera de
                // arriba sigue calculándose sobre $cantidad total, no por color.
                $coloresDetalle = null;
                if (!empty($item['colores']) && is_array($item['colores'])) {
                    $coloresDetalle = json_encode($item['colores'], JSON_UNESCAPED_UNICODE);
                }

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
                    'colores_detalle' => $coloresDetalle,
                ];
            }

            $tokenPublico = bin2hex(random_bytes(16));
            $stmt = $db->prepare("INSERT INTO pedidos (cliente_id,estado,total,observaciones,token_publico) VALUES (?,?,?,?,?)");
            $stmt->bind_param('isdss', $cliente_id, $estado, $totalReal, $obs, $tokenPublico);
            $stmt->execute();
            $pedido_id = $db->insert_id;

            foreach ($itemsProcesados as $item) {
                $is = $db->prepare("INSERT INTO pedido_items (pedido_id,codigo,descripcion,cantidad,precio_unitario,subtotal,en_lista_espera,preventa_nombre,colores_detalle) VALUES (?,?,?,?,?,?,?,?,?)");
                $is->bind_param('issiddiss', $pedido_id, $item['codigo'], $item['descripcion'], $item['cantidad'], $item['precio_unitario'], $item['subtotal'], $item['en_lista_espera'], $item['preventa_nombre'], $item['colores_detalle']);
                $is->execute();
            }

            $es = $db->prepare("INSERT INTO pedido_estados (pedido_id,estado) VALUES (?,?)");
            $es->bind_param('is', $pedido_id, $estado);
            $es->execute();

            $db->commit();
            $tieneListaEspera = false;
            foreach ($itemsProcesados as $it) if ($it['en_lista_espera']) { $tieneListaEspera = true; break; }

            $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
            $basePath = rtrim(str_replace('api.php', '', $_SERVER['SCRIPT_NAME'] ?? ''), '/');
            $urlPublica = $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? '') . $basePath . '/pedido.php?t=' . $tokenPublico;

            // Aviso a Cindy: best-effort, nunca debe romper la creación del
            // pedido (credenciales de UltraMsg sin configurar, red caída,
            // etc. quedan solo en el log, no llegan a la respuesta del cliente).
            try {
                $cliente = $db->query("SELECT nombre, telefono, cuit_dni, domicilio, localidad, cp, provincia, transporte FROM clientes WHERE id=" . intval($cliente_id))->fetch_assoc();
                if ($cliente) {
                    $msgWA = armarMensajeWA($cliente, $cliente['transporte'] ?? '', $obs, $itemsProcesados, $totalReal, $urlPublica);
                    $cfgWA = $db->query("SELECT valor FROM config WHERE clave='whatsapp'")->fetch_assoc();
                    if (!empty($cfgWA['valor'])) {
                        $resultWA = enviarUltraMsg($db, $cfgWA['valor'], $msgWA);
                        if (!$resultWA['ok']) error_log('Aviso UltraMsg de pedido #' . $pedido_id . ' no se envió: ' . ($resultWA['error'] ?? ''));
                    }
                }
            } catch (Exception $eWA) {
                error_log('Aviso UltraMsg de pedido #' . $pedido_id . ' falló: ' . $eWA->getMessage());
            }

            echo json_encode(['ok' => true, 'id' => $pedido_id, 'total' => $totalReal, 'items' => $itemsProcesados, 'tiene_lista_espera' => $tieneListaEspera, 'token_publico' => $tokenPublico, 'url_publica' => $urlPublica]);
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
        // Idempotente: si ya estaba eliminado, no devolver el stock de nuevo
        // (evita duplicar la devolución si se llama dos veces por error).
        $actual = $db->query("SELECT estado FROM pedidos WHERE id=$id")->fetch_assoc();
        if ($actual && $actual['estado'] !== 'ELIMINADO') {
            // Devuelve stock de TODOS los ítems, incluidos los que quedaron
            // en lista de espera al confirmar el pedido (nunca llegaron a
            // descontar de verdad) — decisión consciente por simplicidad,
            // a costa de sumar de más en ese caso puntual.
            $items = $db->query("SELECT codigo, cantidad FROM pedido_items WHERE pedido_id=$id")->fetch_all(MYSQLI_ASSOC);
            foreach ($items as $it) {
                $upd = $db->prepare("UPDATE productos SET stock_preventa = stock_preventa + ? WHERE codigo=?");
                $upd->bind_param('is', $it['cantidad'], $it['codigo']);
                $upd->execute();
            }
        }
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
        // Simétrico con pedido_eliminar: si de verdad estaba eliminado, al
        // restaurarlo se vuelve a descontar el mismo stock que se le había
        // devuelto — si ya no alcanza, se permite igual (stock negativo es
        // información real, no se clampea, mismo criterio de toda la app).
        $actual = $db->query("SELECT estado FROM pedidos WHERE id=$id")->fetch_assoc();
        if ($actual && $actual['estado'] === 'ELIMINADO') {
            $items = $db->query("SELECT codigo, cantidad FROM pedido_items WHERE pedido_id=$id")->fetch_all(MYSQLI_ASSOC);
            foreach ($items as $it) {
                $upd = $db->prepare("UPDATE productos SET stock_preventa = stock_preventa - ? WHERE codigo=?");
                $upd->bind_param('is', $it['cantidad'], $it['codigo']);
                $upd->execute();
            }
        }
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
        // "ingreso" viene del PRODUCTO actual (pr.ingreso), no de un snapshot
        // del ítem — así si se marca/desmarca desde Productos o desde otro
        // pedido, se ve reflejado acá también sin tener que resincronizar nada.
        $pedido['items'] = $db->query("SELECT pi.*, COALESCE(pr.ingreso, 0) as ingreso
            FROM pedido_items pi
            LEFT JOIN productos pr ON pr.codigo = pi.codigo
            WHERE pi.pedido_id=$id")->fetch_all(MYSQLI_ASSOC);
        $pedido['historial'] = $db->query("SELECT * FROM pedido_estados WHERE pedido_id=$id ORDER BY created_at ASC")->fetch_all(MYSQLI_ASSOC);
        echo json_encode($pedido);
        break;

    // Reemplazo deliberado, para acceso público, del patrón inseguro de
    // pedido_detalle (que busca por id autoincremental sin checkAuth — ver
    // nota en el vault). Este busca SIEMPRE por token random, nunca por id,
    // y nunca devuelve PII (teléfono/CUIT/domicilio/email/localidad/
    // provincia/transporte) — solo lo necesario para que un tercero (ej. el
    // revendedor a quien el cliente le reenvía el link) vea el pedido.
    case 'pedido_publico':
        $token = trim($_GET['t'] ?? '');
        if (!$token) { http_response_code(400); die(json_encode(['error' => 'Token requerido'])); }
        $stmt = $db->prepare("SELECT p.id, p.estado, p.total, p.created_at, c.nombre as cliente_nombre
            FROM pedidos p JOIN clientes c ON p.cliente_id=c.id WHERE p.token_publico=?");
        $stmt->bind_param('s', $token);
        $stmt->execute();
        $pedido = $stmt->get_result()->fetch_assoc();
        if (!$pedido) { http_response_code(404); die(json_encode(['error' => 'No encontrado'])); }
        $idInterno = $pedido['id'];
        unset($pedido['id']);
        $itemsStmt = $db->prepare("SELECT codigo, descripcion, cantidad, precio_unitario, subtotal, en_lista_espera, preventa_nombre, colores_detalle FROM pedido_items WHERE pedido_id=?");
        $itemsStmt->bind_param('i', $idInterno);
        $itemsStmt->execute();
        $pedido['items'] = $itemsStmt->get_result()->fetch_all(MYSQLI_ASSOC);
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

    case 'producto_ingreso':
        // Toggle "Ingresó" de UN producto (por código) — se refleja en todos
        // los pedidos que lo incluyan, porque es un atributo del producto.
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $codigo = trim($data['codigo'] ?? '');
        $ingreso = !empty($data['ingreso']) ? 1 : 0;
        $stmt = $db->prepare("UPDATE productos SET ingreso=? WHERE codigo=?");
        $stmt->bind_param('is', $ingreso, $codigo);
        $stmt->execute();
        echo json_encode(['ok' => true]);
        break;

    case 'productos_ingreso_bulk':
        // Marca (o desmarca) "Ingresó" para una LISTA de códigos de una — la
        // herramienta de Herramientas pega una lista de SKU y confirma acá.
        $data = json_decode(file_get_contents('php://input'), true);
        checkAuth($data);
        $codigos = array_values(array_unique(array_filter(array_map('trim', $data['codigos'] ?? []))));
        $ingreso = !empty($data['ingreso']) ? 1 : 0;
        if (!$codigos) { echo json_encode(['ok' => true, 'actualizados' => 0, 'no_encontrados' => []]); break; }
        $placeholders = implode(',', array_fill(0, count($codigos), '?'));
        $types = str_repeat('s', count($codigos));
        $stmt = $db->prepare("UPDATE productos SET ingreso=? WHERE codigo IN ($placeholders)");
        $stmt->bind_param('i' . $types, $ingreso, ...$codigos);
        $stmt->execute();
        // No se usa affected_rows: MySQL no cuenta una fila como "afectada"
        // si el valor ya era el mismo, y acá interesa saber cuántos códigos
        // matchearon de verdad, no cuántos cambiaron.
        $stmt2 = $db->prepare("SELECT codigo FROM productos WHERE codigo IN ($placeholders)");
        $stmt2->bind_param($types, ...$codigos);
        $stmt2->execute();
        $existentes = array_column($stmt2->get_result()->fetch_all(MYSQLI_ASSOC), 'codigo');
        $noEncontrados = array_values(array_diff($codigos, $existentes));
        echo json_encode(['ok' => true, 'actualizados' => count($existentes), 'no_encontrados' => $noEncontrados]);
        break;

    case 'pedidos_por_productos':
        // "¿Quién pidió estos artículos?" — al ir ingresando mercadería física
        // al local, sirve para ver de un vistazo qué pedidos pendientes
        // incluyen una LISTA de códigos (uno o varios) y completarlos a mano.
        // Excluye pedidos ELIMINADOS (no hay nada que completar ahí). Devuelve
        // una fila por cada (pedido, código encontrado) — se agrupa por
        // pedido del lado del cliente, para poder mostrar qué códigos
        // buscados corresponden a cada pedido.
        $data = json_decode(file_get_contents('php://input'), true);
        $codigos = array_values(array_unique(array_filter(array_map('trim', $data['codigos'] ?? []))));
        if (!$codigos) { echo json_encode(['ok' => true, 'items' => []]); break; }
        $placeholders = implode(',', array_fill(0, count($codigos), '?'));
        $types = str_repeat('s', count($codigos));
        $stmt = $db->prepare("SELECT pi.codigo, pi.descripcion, pi.cantidad, pi.colores_detalle, pi.en_lista_espera,
                p.id as pedido_id, p.estado, p.created_at, p.observaciones,
                c.nombre as cliente_nombre, c.telefono as cliente_tel
            FROM pedido_items pi
            JOIN pedidos p ON p.id = pi.pedido_id
            JOIN clientes c ON c.id = p.cliente_id
            WHERE pi.codigo IN ($placeholders) AND p.estado != 'ELIMINADO'
            ORDER BY p.created_at ASC");
        $stmt->bind_param($types, ...$codigos);
        $stmt->execute();
        echo json_encode(['ok' => true, 'items' => $stmt->get_result()->fetch_all(MYSQLI_ASSOC)]);
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
