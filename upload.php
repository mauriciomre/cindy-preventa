<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

define('ADMIN_USER', 'admin');
define('ADMIN_PASS_DEFAULT', 'preventa2026'); // fallback si config.admin_pass no existe — igual que api.php
define('IMG_DIR', __DIR__ . '/imgs/');
define('MAX_SIZE', 5 * 1024 * 1024); // 5MB
define('IMG_W', 800);
define('IMG_H', 800);

// Auth — usa contraseña de BD si fue cambiada
$user = $_POST['_user'] ?? '';
$pass = $_POST['_pass'] ?? '';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/helpers.php';
$db = getDB();
$r = $db->query("SELECT valor FROM config WHERE clave='admin_pass' LIMIT 1");
$row = $r ? $r->fetch_assoc() : null;
$validPass = $row ? $row['valor'] : ADMIN_PASS_DEFAULT;
if ($user !== ADMIN_USER || $pass !== $validPass) {
    http_response_code(401);
    die(json_encode(['error' => 'No autorizado']));
}

// tipo=preventa: portada de una preventa, se guarda aparte en imgs/preventas/
// (mismo resize a cuadro blanco, solo cambia la carpeta y el nombre de archivo).
$esPreventa = ($_POST['tipo'] ?? '') === 'preventa';
$dir = $esPreventa ? IMG_DIR . 'preventas/' : IMG_DIR;

// Crear carpeta si no existe
if (!is_dir($dir)) mkdir($dir, 0755, true);

$codigo = preg_replace('/[^a-zA-Z0-9_\-\.]/', '_', $_POST['codigo'] ?? 'producto');
$allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Dos orígenes posibles: archivo subido a mano, o URL pegada (ej. copiar la
// dirección de una imagen de Google) — mismo pipeline de validación/resize
// para los dos, la única diferencia es de dónde salen los bytes crudos.
$imagenUrl = trim($_POST['imagen_url'] ?? '');
if ($imagenUrl !== '') {
    if (!preg_match('#^https?://#i', $imagenUrl)) {
        http_response_code(400);
        die(json_encode(['error' => 'La URL debe empezar con http:// o https://']));
    }
    $ch = curl_init($imagenUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_MAXREDIRS, 3);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 8);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (compatible; CindyPreventaBot/1.0)');
    // Corta la descarga si se pasa de MAX_SIZE, en vez de confiar solo en
    // Content-Length (que un servidor puede omitir o mentir).
    curl_setopt($ch, CURLOPT_NOPROGRESS, false);
    curl_setopt($ch, CURLOPT_PROGRESSFUNCTION, function ($res, $expectedDl, $dl) {
        return $dl > MAX_SIZE ? 1 : 0;
    });
    $binario = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);
    if ($err || $binario === false) {
        http_response_code(400);
        die(json_encode(['error' => 'No se pudo descargar la imagen de esa URL' . ($err ? ": $err" : '')]));
    }
    if (strlen($binario) > MAX_SIZE) {
        http_response_code(400);
        die(json_encode(['error' => 'La imagen supera los 5MB']));
    }
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mime = finfo_buffer($finfo, $binario);
    finfo_close($finfo);
    if (!in_array($mime, $allowed)) {
        http_response_code(400);
        die(json_encode(['error' => 'Esa URL no es una imagen JPG, PNG o WebP válida']));
    }
    $src = @imagecreatefromstring($binario);
    if (!$src) { http_response_code(400); die(json_encode(['error' => 'No se pudo procesar la imagen descargada'])); }
} else {
    if (!isset($_FILES['imagen']) || $_FILES['imagen']['error'] !== UPLOAD_ERR_OK) {
        http_response_code(400);
        die(json_encode(['error' => 'No se recibió ninguna imagen']));
    }

    $file = $_FILES['imagen'];

    // Validar tamaño
    if ($file['size'] > MAX_SIZE) {
        http_response_code(400);
        die(json_encode(['error' => 'La imagen supera los 5MB']));
    }

    // Validar tipo
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mime = finfo_file($finfo, $file['tmp_name']);
    finfo_close($finfo);
    if (!in_array($mime, $allowed)) {
        http_response_code(400);
        die(json_encode(['error' => 'Formato no permitido. Usá JPG, PNG o WebP']));
    }

    // Cargar imagen según tipo
    switch ($mime) {
        case 'image/jpeg': $src = imagecreatefromjpeg($file['tmp_name']); break;
        case 'image/png':  $src = imagecreatefrompng($file['tmp_name']); break;
        case 'image/webp': $src = imagecreatefromwebp($file['tmp_name']); break;
        case 'image/gif':  $src = imagecreatefromgif($file['tmp_name']); break;
        default: http_response_code(400); die(json_encode(['error' => 'Formato no soportado']));
    }
}

$dst = redimensionar_a_cuadro($src, IMG_W, IMG_H);

// Guardar como JPEG
$filename = $codigo . '.jpeg';
$filepath = $dir . $filename;
imagejpeg($dst, $filepath, 85);

imagedestroy($src);
imagedestroy($dst);

echo json_encode([
    'ok' => true,
    'filename' => $filename,
    'url' => ($esPreventa ? 'imgs/preventas/' : 'imgs/') . $filename
]);
?>