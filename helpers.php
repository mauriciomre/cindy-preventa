<?php
// Redimensiona una imagen GD a un cuadro de w×h con fondo blanco, manteniendo
// la proporción original centrada. Compartido entre upload.php (subida manual)
// y la búsqueda de fotos en Manager2Max en api.php (importación por Excel).
function redimensionar_a_cuadro($src, $w = 800, $h = 800) {
    $ow = imagesx($src);
    $oh = imagesy($src);
    $ratio = min($w / $ow, $h / $oh);
    $nw = intval($ow * $ratio);
    $nh = intval($oh * $ratio);
    $ox = intval(($w - $nw) / 2);
    $oy = intval(($h - $nh) / 2);

    $dst = imagecreatetruecolor($w, $h);
    $white = imagecolorallocate($dst, 255, 255, 255);
    imagefill($dst, 0, 0, $white);
    imagecopyresampled($dst, $src, $ox, $oy, 0, 0, $nw, $nh, $ow, $oh);
    return $dst;
}

// Para portadas de preventa: a diferencia de una foto de producto (que se
// muestra completa con object-fit:contain, por eso necesita el lienzo
// blanco de arriba), la portada siempre se recorta con background-size:cover
// para llenar la card — nunca se ve completa. Rellenarla en un cuadro
// blanco ahí no ayuda, y si la foto no es cuadrada agrega relleno de más
// a los costados (o arriba/abajo) que después el cover no puede sacar.
// Acá solo se limita el tamaño máximo (no upscalea) y se devuelve la
// imagen en su proporción original, sin agregar nada.
function redimensionar_preventa_cover($src, $maxW = 1200, $maxH = 900) {
    $ow = imagesx($src);
    $oh = imagesy($src);
    $ratio = min($maxW / $ow, $maxH / $oh, 1);
    $nw = max(1, intval($ow * $ratio));
    $nh = max(1, intval($oh * $ratio));

    $dst = imagecreatetruecolor($nw, $nh);
    imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $ow, $oh);
    return $dst;
}

// ── Login del panel (tabla `usuarios`) ───────────────────────────────────────
// Compartido por api.php, upload.php y upload_bulk.php. Si la tabla todavía no existe o
// está vacía (antes de la primera migración) se usa el login viejo del único usuario
// "admin" (config.admin_pass o la contraseña por defecto), para no dejar a nadie afuera.
function auth_validar($db, $u, $p, $passDefecto = 'preventa2026') {
    $u = trim((string)$u);
    $p = (string)$p;
    if ($u === '' || $p === '') return false;
    $hayUsuarios = false;
    try {
        $r = $db->query("SELECT COUNT(*) AS n FROM usuarios");
        $hayUsuarios = $r && intval($r->fetch_assoc()['n']) > 0;
    } catch (Throwable $e) {
        $hayUsuarios = false;
    }
    if (!$hayUsuarios) {
        $valida = $passDefecto;
        try {
            $r = $db->query("SELECT valor FROM config WHERE clave='admin_pass' LIMIT 1");
            $row = $r ? $r->fetch_assoc() : null;
            if ($row) $valida = $row['valor'];
        } catch (Throwable $e) {}
        return $u === 'admin' && hash_equals($valida, $p);
    }
    $st = $db->prepare("SELECT pass_hash FROM usuarios WHERE nombre=? AND activo=1 LIMIT 1");
    $st->bind_param('s', $u);
    $st->execute();
    $row = $st->get_result()->fetch_assoc();
    return $row && password_verify($p, $row['pass_hash']);
}

// Hash de contraseña para `usuarios`. Costo 9 (en vez de 10): el panel manda las
// credenciales en cada llamada y se verifica el hash en todas, así pesa menos.
function hash_clave($clave) {
    return password_hash($clave, PASSWORD_BCRYPT, ['cost' => 9]);
}
