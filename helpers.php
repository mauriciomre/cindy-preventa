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
?>
