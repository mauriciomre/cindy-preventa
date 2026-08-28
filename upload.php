<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

define('ADMIN_USER', 'admin');
define('ADMIN_PASS_DEFAULT', 'cindy2120');
define('IMG_DIR', __DIR__ . '/imgs/');
define('MAX_SIZE', 5 * 1024 * 1024); // 5MB
define('IMG_W', 800);
define('IMG_H', 800);

// Auth — usa contraseña de BD si fue cambiada
$user = $_POST['_user'] ?? '';
$pass = $_POST['_pass'] ?? '';
require_once __DIR__ . '/db.php';
$db = getDB();
$r = $db->query("SELECT valor FROM config WHERE clave='admin_pass' LIMIT 1");
$row = $r ? $r->fetch_assoc() : null;
$validPass = $row ? $row['valor'] : ADMIN_PASS_DEFAULT;
if ($user !== ADMIN_USER || $pass !== $validPass) {
    http_response_code(401);
    die(json_encode(['error' => 'No autorizado']));
}

// Crear carpeta si no existe
if (!is_dir(IMG_DIR)) mkdir(IMG_DIR, 0755, true);

if (!isset($_FILES['imagen']) || $_FILES['imagen']['error'] !== UPLOAD_ERR_OK) {
    http_response_code(400);
    die(json_encode(['error' => 'No se recibió ninguna imagen']));
}

$file = $_FILES['imagen'];
$codigo = preg_replace('/[^a-zA-Z0-9_\-\.]/', '_', $_POST['codigo'] ?? 'producto');

// Validar tamaño
if ($file['size'] > MAX_SIZE) {
    http_response_code(400);
    die(json_encode(['error' => 'La imagen supera los 5MB']));
}

// Validar tipo
$finfo = finfo_open(FILEINFO_MIME_TYPE);
$mime = finfo_file($finfo, $file['tmp_name']);
finfo_close($finfo);
$allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
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

$ow = imagesx($src);
$oh = imagesy($src);

// Calcular dimensiones manteniendo proporción con fondo blanco
$ratio = min(IMG_W / $ow, IMG_H / $oh);
$nw = intval($ow * $ratio);
$nh = intval($oh * $ratio);
$ox = intval((IMG_W - $nw) / 2);
$oy = intval((IMG_H - $nh) / 2);

// Canvas blanco 800x800
$dst = imagecreatetruecolor(IMG_W, IMG_H);
$white = imagecolorallocate($dst, 255, 255, 255);
imagefill($dst, 0, 0, $white);

// Copiar imagen redimensionada centrada
imagecopyresampled($dst, $src, $ox, $oy, 0, 0, $nw, $nh, $ow, $oh);

// Guardar como JPEG
$filename = $codigo . '.jpeg';
$filepath = IMG_DIR . $filename;
imagejpeg($dst, $filepath, 85);

imagedestroy($src);
imagedestroy($dst);

echo json_encode([
    'ok' => true,
    'filename' => $filename,
    'url' => 'imgs/' . $filename
]);
?>