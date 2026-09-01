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
?>
