<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

define('IMG_DIR',    __DIR__ . '/imgs/');
define('IMG_W',      800);
define('IMG_H',      800);
define('MAX_SINGLE', 5  * 1024 * 1024);   // 5 MB por imagen
define('MAX_ZIP',    100 * 1024 * 1024);   // 100 MB ZIP

// ── Auth ──────────────────────────────────────────────────────────────────
require_once __DIR__ . '/db.php';
$db = getDB();

$user = $_POST['_user'] ?? '';
$pass = $_POST['_pass'] ?? '';
$r = $db->query("SELECT valor FROM config WHERE clave='admin_pass' LIMIT 1");
$row = $r ? $r->fetch_assoc() : null;
$validPass = $row ? $row['valor'] : 'travelblue2025';
if ($user !== 'admin' || $pass !== $validPass) {
    http_response_code(401);
    die(json_encode(['error' => 'No autorizado']));
}

if (!is_dir(IMG_DIR)) mkdir(IMG_DIR, 0755, true);

// ── Helpers ───────────────────────────────────────────────────────────────
function codigoFromFilename($filename) {
    // nombre sin extensión = CODIGO exacto del producto
    return pathinfo(basename($filename), PATHINFO_FILENAME);
}

function processImage($tmpPath, $codigo, $db) {
    // Verificar mime real
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mime  = finfo_file($finfo, $tmpPath);
    finfo_close($finfo);
    $allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!in_array($mime, $allowed)) {
        return ['codigo' => $codigo, 'status' => 'error', 'msg' => 'Formato no permitido'];
    }

    // Verificar que el producto existe
    $stmt = $db->prepare("SELECT id FROM productos WHERE codigo=?");
    $stmt->bind_param('s', $codigo);
    $stmt->execute();
    if (!$stmt->get_result()->fetch_assoc()) {
        return ['codigo' => $codigo, 'status' => 'not_found', 'msg' => 'Producto no encontrado'];
    }

    // Cargar imagen
    switch ($mime) {
        case 'image/jpeg': $src = imagecreatefromjpeg($tmpPath); break;
        case 'image/png':  $src = imagecreatefrompng($tmpPath);  break;
        case 'image/webp': $src = imagecreatefromwebp($tmpPath); break;
        case 'image/gif':  $src = imagecreatefromgif($tmpPath);  break;
        default: return ['codigo' => $codigo, 'status' => 'error', 'msg' => 'Formato inválido'];
    }
    if (!$src) return ['codigo' => $codigo, 'status' => 'error', 'msg' => 'No se pudo leer la imagen'];

    // Redimensionar a 800×800 con fondo blanco (igual que upload.php)
    $ow = imagesx($src); $oh = imagesy($src);
    $ratio = min(IMG_W / $ow, IMG_H / $oh);
    $nw = intval($ow * $ratio); $nh = intval($oh * $ratio);
    $ox = intval((IMG_W - $nw) / 2); $oy = intval((IMG_H - $nh) / 2);

    $dst   = imagecreatetruecolor(IMG_W, IMG_H);
    $white = imagecolorallocate($dst, 255, 255, 255);
    imagefill($dst, 0, 0, $white);
    imagecopyresampled($dst, $src, $ox, $oy, 0, 0, $nw, $nh, $ow, $oh);

    // Guardar
    $safeCode = preg_replace('/[^a-zA-Z0-9_\-\.]/', '_', $codigo);
    $filename  = $safeCode . '.jpeg';
    $filepath  = IMG_DIR . $filename;
    imagejpeg($dst, $filepath, 85);
    imagedestroy($src);
    imagedestroy($dst);

    // Actualizar campo foto en la BD
    $fotoVal = 'imgs/' . $filename;
    $upd = $db->prepare("UPDATE productos SET foto=? WHERE codigo=?");
    $upd->bind_param('ss', $fotoVal, $codigo);
    $upd->execute();

    return ['codigo' => $codigo, 'status' => 'updated', 'filename' => $filename];
}

// ── Procesar archivos ─────────────────────────────────────────────────────
$results = [];

if (isset($_FILES['zipfile']) && $_FILES['zipfile']['error'] === UPLOAD_ERR_OK) {
    // ── Modo ZIP ──────────────────────────────────────────────────────────
    if (!class_exists('ZipArchive')) {
        http_response_code(500);
        die(json_encode(['error' => 'ZipArchive no está disponible en este servidor']));
    }
    if ($_FILES['zipfile']['size'] > MAX_ZIP) {
        http_response_code(400);
        die(json_encode(['error' => 'El ZIP supera los 100 MB']));
    }

    $zip = new ZipArchive();
    if ($zip->open($_FILES['zipfile']['tmp_name']) !== true) {
        http_response_code(400);
        die(json_encode(['error' => 'No se pudo abrir el archivo ZIP']));
    }

    for ($i = 0; $i < $zip->numFiles; $i++) {
        $name = $zip->getNameIndex($i);
        // Ignorar carpetas y archivos ocultos (macOS __MACOSX, etc.)
        if (substr($name, -1) === '/' || strpos(basename($name), '.') === 0) continue;
        if (strpos($name, '__MACOSX') !== false) continue;
        $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        if (!in_array($ext, ['jpg', 'jpeg', 'png', 'webp'])) continue;

        $tmp = tempnam(sys_get_temp_dir(), 'tbimg_');
        file_put_contents($tmp, $zip->getFromIndex($i));
        $codigo = codigoFromFilename(basename($name));
        $results[] = processImage($tmp, $codigo, $db);
        unlink($tmp);
    }
    $zip->close();

} elseif (isset($_FILES['images'])) {
    // ── Modo multi-imagen ─────────────────────────────────────────────────
    $files = $_FILES['images'];
    $count = is_array($files['name']) ? count($files['name']) : 1;

    for ($i = 0; $i < $count; $i++) {
        $name  = is_array($files['name'])     ? $files['name'][$i]     : $files['name'];
        $tmp   = is_array($files['tmp_name']) ? $files['tmp_name'][$i] : $files['tmp_name'];
        $error = is_array($files['error'])    ? $files['error'][$i]    : $files['error'];
        $size  = is_array($files['size'])     ? $files['size'][$i]     : $files['size'];

        if ($error !== UPLOAD_ERR_OK) {
            $results[] = ['codigo' => codigoFromFilename($name), 'status' => 'error', 'msg' => 'Error al subir el archivo'];
            continue;
        }
        if ($size > MAX_SINGLE) {
            $results[] = ['codigo' => codigoFromFilename($name), 'status' => 'error', 'msg' => 'Supera 5 MB'];
            continue;
        }
        $results[] = processImage($tmp, codigoFromFilename($name), $db);
    }

} else {
    http_response_code(400);
    die(json_encode(['error' => 'No se recibieron archivos']));
}

// ── Resumen ───────────────────────────────────────────────────────────────
$summary = ['updated' => 0, 'not_found' => 0, 'errors' => 0];
foreach ($results as $res) {
    if     ($res['status'] === 'updated')   $summary['updated']++;
    elseif ($res['status'] === 'not_found') $summary['not_found']++;
    else                                    $summary['errors']++;
}

echo json_encode(['ok' => true, 'results' => $results, 'summary' => $summary]);
