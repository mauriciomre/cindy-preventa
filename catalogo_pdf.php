<?php
// PDF del catálogo de UNA preventa (público): catalogo_pdf.php?preventa=ID
//
// Se arma en el servidor con tFPDF (vendor/tfpdf) imitando el catálogo: franja negra,
// logo PRE/VENTA, títulos de categoría con barra naranja y cards con foto, código,
// nombre, marca, colores y precio. Solo van los productos DISPONIBLES (los agotados
// no). El PDF se guarda en cache/catalogo_pdf/ y solo se vuelve a generar cuando cambia
// algo de esa preventa (productos, precios, fotos, colores, textos) o el diseño.
//
// Al cambiar el diseño, subir PDF_LAYOUT_VERSION para invalidar los PDF guardados.

define('PDF_LAYOUT_VERSION', '1');

@set_time_limit(180);
@ini_set('memory_limit', '256M');
ignore_user_abort(true);

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/vendor/tfpdf/tfpdf.php';
require_once __DIR__ . '/vendor/tfpdf/font/unifont/ttfonts.php'; // tFPDF no lo incluye solo

function pdf_error($code, $msg) {
    http_response_code($code);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><meta charset="utf-8"><title>Catálogo PDF</title><body style="font-family:sans-serif;padding:24px">' . htmlspecialchars($msg) . '</body>';
    exit;
}

function pdf_slug($s) {
    $t = @iconv('UTF-8', 'ASCII//TRANSLIT', $s);
    if ($t === false || $t === '') $t = $s;
    $t = strtolower(preg_replace('/[^A-Za-z0-9]+/', '-', $t));
    return trim($t, '-') ?: 'preventa';
}

function pdf_hex($hex) {
    $hex = ltrim((string)$hex, '#');
    if (strlen($hex) === 3) $hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
    if (!preg_match('/^[0-9a-fA-F]{6}$/', $hex)) return [200, 200, 200];
    return [hexdec(substr($hex, 0, 2)), hexdec(substr($hex, 2, 2)), hexdec(substr($hex, 4, 2))];
}

function pdf_fmt_precio($v) {
    return '$ ' . number_format(round((float)$v), 0, ',', '.');
}

// Carpeta de caché: cache/<sub> del proyecto; si el hosting no deja escribir ahí, la carpeta temporal del sistema.
function pdf_cache_dir($sub) {
    $dir = __DIR__ . '/cache/' . $sub;
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    if (is_dir($dir) && is_writable($dir)) return $dir;
    $tmp = rtrim(sys_get_temp_dir(), '/\\') . '/cindy_preventa_' . $sub;
    if (!is_dir($tmp)) @mkdir($tmp, 0755, true);
    return $tmp;
}

// Ruta de la foto de un producto en disco (null si es una URL externa o no existe).
function pdf_foto_path($foto, $codigo) {
    if (!empty($foto)) {
        if (strpos($foto, 'http') === 0) return null;
        $p = __DIR__ . '/' . ltrim($foto, '/');
    } else {
        $p = __DIR__ . '/imgs/' . str_replace('/', '_', (string)$codigo) . '.jpeg';
    }
    return is_file($p) ? $p : null;
}

// Miniatura (JPEG 360 px sobre fondo blanco) guardada en cache/thumbs: el PDF pesa
// una fracción de las fotos originales de 800 px.
function pdf_thumb($src) {
    $dir = pdf_cache_dir('thumbs');
    $dst = $dir . '/' . sha1($src) . '_' . filemtime($src) . '.jpg';
    if (is_file($dst)) return $dst;
    $info = @getimagesize($src);
    if (!$info) return null;
    switch ($info[2]) {
        case IMAGETYPE_JPEG: $im = @imagecreatefromjpeg($src); break;
        case IMAGETYPE_PNG:  $im = @imagecreatefrompng($src);  break;
        case IMAGETYPE_GIF:  $im = @imagecreatefromgif($src);  break;
        case IMAGETYPE_WEBP: $im = function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($src) : false; break;
        default: $im = false;
    }
    if (!$im) return null;
    $w = imagesx($im); $h = imagesy($im);
    $S = 360;
    $scale = min($S / $w, $S / $h);
    $nw = max(1, (int)round($w * $scale)); $nh = max(1, (int)round($h * $scale));
    $canvas = imagecreatetruecolor($S, $S);
    imagefill($canvas, 0, 0, imagecolorallocate($canvas, 255, 255, 255));
    imagecopyresampled($canvas, $im, (int)(($S - $nw) / 2), (int)(($S - $nh) / 2), 0, 0, $nw, $nh, $w, $h);
    imagejpeg($canvas, $dst, 72);
    imagedestroy($im); imagedestroy($canvas);
    return is_file($dst) ? $dst : null;
}

class CatalogoPDF extends tFPDF {
    public $titulo = '';
    public $detalle = '';
    public $total = 0;
    public $fecha = '';

    const W = 210;
    const H = 297;
    const MX = 10;

    function Header() {
        $this->SetFillColor(246, 242, 236);          // fondo crema del catálogo
        $this->Rect(0, 0, self::W, self::H, 'F');
        if ($this->PageNo() === 1) {
            // Franja negra "PREVENTA — RESERVÁ ANTES DE QUE LLEGUE"
            $this->SetFillColor(23, 20, 18);
            $this->Rect(0, 0, self::W, 8, 'F');
            $this->SetFillColor(232, 78, 27);
            $this->RoundedRect(self::MX - 0.9, 3.1, 1.8, 1.8, 0.9, 'F');
            $this->SetFont('JostSB', '', 6.5);
            $this->SetTextColor(255, 255, 255);
            $this->SetXY(self::MX + 2.4, 2.4);
            $this->Cell(120, 3.2, 'PREVENTA — RESERVÁ ANTES DE QUE LLEGUE', 0, 0, 'L');
            // Encabezado blanco con el logo
            $this->SetFillColor(255, 255, 255);
            $this->Rect(0, 8, self::W, 22, 'F');
            $this->SetDrawColor(229, 222, 212);
            $this->Line(0, 30, self::W, 30);
            $this->logo(self::MX, 14.5, 25);
            $this->SetFont('Jost', '', 7.5);
            $this->SetTextColor(120, 112, 106);
            $this->SetXY(self::W - self::MX - 70, 17);
            $this->Cell(70, 4, 'Actualizado ' . $this->fecha, 0, 0, 'R');
            // Título de la preventa
            $this->SetFont('Jost', 'B', 19);
            $this->SetTextColor(23, 20, 18);
            $this->SetXY(self::MX, 35);
            $this->Cell(self::W - 2 * self::MX, 9, $this->titulo, 0, 1, 'L');
            $y = 45;
            if ($this->detalle !== '') {
                $this->SetFont('Jost', '', 9);
                $this->SetTextColor(120, 112, 106);
                $this->SetXY(self::MX, $y);
                $this->Cell(self::W - 2 * self::MX, 4.5, $this->detalle, 0, 1, 'L');
                $y += 5;
            }
            $this->SetFont('Jost', '', 8);
            $this->SetXY(self::MX, $y);
            $this->Cell(self::W - 2 * self::MX, 4, $this->total . ' productos · Precios mayoristas + IVA', 0, 1, 'L');
            $this->SetY($y + 7);
        } else {
            $this->SetFillColor(255, 255, 255);
            $this->Rect(0, 0, self::W, 13, 'F');
            $this->SetDrawColor(229, 222, 212);
            $this->Line(0, 13, self::W, 13);
            $this->logo(self::MX, 4.2, 11);
            $this->SetFont('JostSB', '', 8);
            $this->SetTextColor(120, 112, 106);
            $this->SetXY(self::W - self::MX - 100, 5.2);
            $this->Cell(100, 4, $this->titulo, 0, 0, 'R');
            $this->SetY(18);
        }
    }

    function Footer() {
        $this->SetY(-9);
        $this->SetFont('Jost', '', 6.5);
        $this->SetTextColor(120, 112, 106);
        $this->SetX(self::MX);
        $this->Cell(120, 4, 'Precios mayoristas + IVA, sujetos a cambio sin previo aviso.', 0, 0, 'L');
        $this->SetX(self::W - self::MX - 40);
        $this->Cell(40, 4, 'Página ' . $this->PageNo() . ' de {nb}', 0, 0, 'R');
    }

    // Logo PRE(negro)VENTA(naranja) a un tamaño de letra dado.
    function logo($x, $y, $size) {
        $this->SetFont('Jost', 'B', $size);
        $wPre = $this->GetStringWidth('PRE');
        $h = $size * 0.3528 * 1.1;
        $this->SetTextColor(23, 20, 18);
        $this->SetXY($x, $y);
        $this->Cell($wPre, $h, 'PRE', 0, 0, 'L');
        $this->SetTextColor(232, 78, 27);
        $this->Cell($this->GetStringWidth('VENTA'), $h, 'VENTA', 0, 0, 'L');
    }

    // Rectángulo con esquinas redondeadas (extensión clásica de FPDF).
    function RoundedRect($x, $y, $w, $h, $r, $style = '') {
        $k = $this->k; $hp = $this->h;
        $op = $style === 'F' ? 'f' : (($style === 'FD' || $style === 'DF') ? 'B' : 'S');
        $arc = 4 / 3 * (sqrt(2) - 1);
        $this->_out(sprintf('%.2F %.2F m', ($x + $r) * $k, ($hp - $y) * $k));
        $xc = $x + $w - $r; $yc = $y + $r;
        $this->_out(sprintf('%.2F %.2F l', $xc * $k, ($hp - $y) * $k));
        $this->_arc($xc + $r * $arc, $yc - $r, $xc + $r, $yc - $r * $arc, $xc + $r, $yc);
        $xc = $x + $w - $r; $yc = $y + $h - $r;
        $this->_out(sprintf('%.2F %.2F l', ($x + $w) * $k, ($hp - $yc) * $k));
        $this->_arc($xc + $r, $yc + $r * $arc, $xc + $r * $arc, $yc + $r, $xc, $yc + $r);
        $xc = $x + $r; $yc = $y + $h - $r;
        $this->_out(sprintf('%.2F %.2F l', $xc * $k, ($hp - ($y + $h)) * $k));
        $this->_arc($xc - $r * $arc, $yc + $r, $xc - $r, $yc + $r * $arc, $xc - $r, $yc);
        $xc = $x + $r; $yc = $y + $r;
        $this->_out(sprintf('%.2F %.2F l', $x * $k, ($hp - $yc) * $k));
        $this->_arc($xc - $r, $yc - $r * $arc, $xc - $r * $arc, $yc - $r, $xc, $yc - $r);
        $this->_out($op);
    }

    function _arc($x1, $y1, $x2, $y2, $x3, $y3) {
        $h = $this->h;
        $this->_out(sprintf('%.2F %.2F %.2F %.2F %.2F %.2F c ', $x1 * $this->k, ($h - $y1) * $this->k, $x2 * $this->k, ($h - $y2) * $this->k, $x3 * $this->k, ($h - $y3) * $this->k));
    }

    // Parte un texto en líneas que entren en $maxW (con la fuente ya elegida); recorta con "...".
    function lineas($texto, $maxW, $maxLineas) {
        $palabras = preg_split('/\s+/u', trim((string)$texto));
        $lineas = []; $actual = '';
        foreach ($palabras as $p) {
            if ($p === '') continue;
            $prueba = $actual === '' ? $p : $actual . ' ' . $p;
            if ($this->GetStringWidth($prueba) <= $maxW) { $actual = $prueba; continue; }
            if ($actual !== '') $lineas[] = $actual;
            $actual = $p;
        }
        if ($actual !== '') $lineas[] = $actual;
        if (count($lineas) > $maxLineas) {
            $lineas = array_slice($lineas, 0, $maxLineas);
            $u = rtrim($lineas[$maxLineas - 1], ' .,');
            while ($u !== '' && $this->GetStringWidth($u . '...') > $maxW) $u = mb_substr($u, 0, mb_strlen($u) - 1);
            $lineas[$maxLineas - 1] = $u . '...';
        }
        return $lineas;
    }
}

// ───────────────────────── datos ─────────────────────────
$idPv = intval($_GET['preventa'] ?? 0);
if ($idPv <= 0) pdf_error(400, 'Falta indicar la preventa.');

$db = getDB();
$stmt = $db->prepare("SELECT id, nombre, detalle FROM preventas WHERE id=? AND activa=1");
$stmt->bind_param('i', $idPv);
$stmt->execute();
$pv = $stmt->get_result()->fetch_assoc();
if (!$pv) pdf_error(404, 'Esa preventa no está disponible.');

$stmt = $db->prepare("SELECT p.id, p.codigo, p.descripcion, p.categoria, p.marca, p.precio_mayorista, p.multiplo, p.foto
    FROM productos p LEFT JOIN categorias c ON p.categoria = c.nombre
    WHERE p.preventa_id=? AND p.estado='DISPONIBLE'
    ORDER BY COALESCE(c.orden, 0), p.orden, p.codigo");
$stmt->bind_param('i', $idPv);
$stmt->execute();
$productos = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

$colores = [];
if ($productos) {
    $ids = implode(',', array_map('intval', array_column($productos, 'id')));
    $rc = $db->query("SELECT pc.producto_id, c.nombre, c.hex FROM producto_colores pc JOIN colores c ON c.id = pc.color_id WHERE pc.producto_id IN ($ids) ORDER BY c.nombre");
    while ($r = $rc->fetch_assoc()) $colores[$r['producto_id']][] = ['nombre' => $r['nombre'], 'hex' => $r['hex']];
}

// ───────────────────────── caché ─────────────────────────
$firma = [PDF_LAYOUT_VERSION, $pv['nombre'], $pv['detalle']];
foreach ($productos as $p) {
    $path = pdf_foto_path($p['foto'], $p['codigo']);
    $firma[] = [$p['codigo'], $p['descripcion'], $p['categoria'], $p['marca'], $p['precio_mayorista'], $p['multiplo'], $path ? filemtime($path) : 0, $colores[$p['id']] ?? []];
}
$hash = substr(md5(json_encode($firma)), 0, 16);
$dirPdf = pdf_cache_dir('catalogo_pdf');
$archivo = $dirPdf . '/' . $idPv . '_' . $hash . '.pdf';
$nombreDescarga = 'catalogo-' . pdf_slug($pv['nombre']) . '.pdf';

function pdf_enviar($archivo, $nombre) {
    // ?calentar=1: solo se asegura de que el PDF esté generado (lo pide el admin en segundo plano).
    if (isset($_GET['calentar'])) { http_response_code(204); exit; }
    header('Content-Type: application/pdf');
    header('Content-Disposition: ' . (isset($_GET['ver']) ? 'inline' : 'attachment') . '; filename="' . $nombre . '"');
    header('Content-Length: ' . filesize($archivo));
    header('Cache-Control: private, max-age=300');
    readfile($archivo);
    exit;
}

if (is_file($archivo)) pdf_enviar($archivo, $nombreDescarga);

// Un solo proceso genera a la vez: los demás esperan y reutilizan el resultado.
$lock = fopen($dirPdf . '/' . $idPv . '.lock', 'c');
if ($lock) flock($lock, LOCK_EX);
if (is_file($archivo)) pdf_enviar($archivo, $nombreDescarga);

// ───────────────────────── armado del PDF ─────────────────────────
$pdf = new CatalogoPDF('P', 'mm', 'A4');
$pdf->AddFont('Jost', '', 'Jost-Regular.ttf', true);
$pdf->AddFont('Jost', 'B', 'Jost-Bold.ttf', true);
$pdf->AddFont('JostSB', '', 'Jost-SemiBold.ttf', true);
$pdf->SetTitle($pv['nombre'], true);
$pdf->SetAuthor('Preventa', true);
$pdf->SetAutoPageBreak(false);
$pdf->SetMargins(CatalogoPDF::MX, 10, CatalogoPDF::MX);
$pdf->AliasNbPages('{nb}');
$pdf->titulo = $pv['nombre'];
$pdf->detalle = (string)($pv['detalle'] ?? '');
$pdf->total = count($productos);
$pdf->fecha = date('d/m/Y');
$pdf->AddPage();

$COLS = 4; $GAP = 4;
$cardW = (CatalogoPDF::W - 2 * CatalogoPDF::MX - ($COLS - 1) * $GAP) / $COLS;
$padX = 2.6;
$limiteY = CatalogoPDF::H - 13;

// Alto de una card según su contenido (nombre en hasta 3 líneas, colores, múltiplo…).
function card_info($pdf, $p, $colores, $cardW, $padX) {
    $info = [];
    $pdf->SetFont('JostSB', '', 7.6);
    $info['nombre'] = $pdf->lineas($p['descripcion'], $cardW - 2 * $padX, 3);
    $info['colores'] = $colores[$p['id']] ?? [];
    $info['multiplo'] = max(1, intval($p['multiplo']));
    $pdf->SetFont('Jost', '', 5.8);
    $nombresColor = array_map(function ($c) { return $c['nombre']; }, $info['colores']);
    $info['txtColores'] = $nombresColor ? $pdf->lineas(implode(' · ', $nombresColor), $cardW - 2 * $padX, 2) : [];
    $h = ($cardW - 0.8) + 0.4 + 2.6;                  // foto + marco + aire
    $h += 4.2;                                        // código
    $h += count($info['nombre']) * 3.5 + 1;           // nombre
    if (!empty($p['marca'])) $h += 3.4;               // marca
    if ($info['colores']) $h += 3.6 + count($info['txtColores']) * 2.6; // puntos + nombres
    if ($info['multiplo'] > 1) $h += 3;               // "Se pide de a N"
    $h += 8.8;                                        // precio
    $info['h'] = $h;
    return $info;
}

function dibujar_card($pdf, $p, $info, $x, $y, $cardW, $padX, $rowH) {
    // Card blanca con borde
    $pdf->SetFillColor(255, 255, 255);
    $pdf->SetDrawColor(229, 222, 212);
    $pdf->SetLineWidth(0.2);
    $pdf->RoundedRect($x, $y, $cardW, $rowH, 2, 'FD');
    // Foto
    $img = $cardW - 0.8;
    $pdf->SetFillColor(248, 249, 251);
    $pdf->Rect($x + 0.4, $y + 0.4, $img, $img, 'F');
    $src = pdf_foto_path($p['foto'], $p['codigo']);
    $thumb = $src ? pdf_thumb($src) : null;
    if ($thumb) {
        $pdf->Image($thumb, $x + 0.4, $y + 0.4, $img, $img, 'JPG');
    } else {
        $pdf->SetFont('Jost', '', 6);
        $pdf->SetTextColor(170, 165, 160);
        $pdf->SetXY($x + 0.4, $y + 0.4 + $img / 2 - 2);
        $pdf->Cell($img, 4, 'Sin foto', 0, 0, 'C');
    }
    $pdf->SetDrawColor(229, 222, 212);
    $pdf->Line($x + 0.4, $y + 0.4 + $img, $x + 0.4 + $img, $y + 0.4 + $img);
    // Cuerpo
    $cy = $y + 0.4 + $img + 2.6;
    // código
    $pdf->SetFont('Jost', '', 6);
    $cw = min($cardW - 2 * $padX, $pdf->GetStringWidth($p['codigo']) + 3);
    $pdf->SetFillColor(245, 245, 245);
    $pdf->RoundedRect($x + $padX, $cy, $cw, 3.6, 0.8, 'F');
    $pdf->SetTextColor(120, 112, 106);
    $pdf->SetXY($x + $padX, $cy + 0.2);
    $pdf->Cell($cw, 3.2, $p['codigo'], 0, 0, 'C');
    $cy += 4.2;
    // nombre
    $pdf->SetFont('JostSB', '', 7.6);
    $pdf->SetTextColor(23, 20, 18);
    foreach ($info['nombre'] as $ln) {
        $pdf->SetXY($x + $padX, $cy);
        $pdf->Cell($cardW - 2 * $padX, 3.5, $ln, 0, 0, 'L');
        $cy += 3.5;
    }
    $cy += 1;
    // marca
    if (!empty($p['marca'])) {
        $pdf->SetFont('Jost', '', 6.2);
        $pdf->SetTextColor(120, 112, 106);
        $pdf->SetXY($x + $padX, $cy);
        $pdf->Cell($cardW - 2 * $padX, 3.2, $p['marca'], 0, 0, 'L');
        $cy += 3.4;
    }
    // colores (puntos como en el catálogo + nombres)
    if ($info['colores']) {
        $dx = $x + $padX; $r = 1.35; $max = 9;
        $n = 0;
        foreach ($info['colores'] as $c) {
            if ($n >= $max) break;
            list($rr, $gg, $bb) = pdf_hex($c['hex']);
            $pdf->SetDrawColor(205, 200, 195);
            $pdf->SetFillColor($rr, $gg, $bb);
            $pdf->SetLineWidth(0.15);
            $pdf->RoundedRect($dx, $cy + 0.4, $r * 2, $r * 2, $r, 'FD');
            $dx += $r * 2 + 0.9;
            $n++;
        }
        $cy += 3.6;
        $pdf->SetFont('Jost', '', 5.8);
        $pdf->SetTextColor(120, 112, 106);
        foreach ($info['txtColores'] as $ln) {
            $pdf->SetXY($x + $padX, $cy);
            $pdf->Cell($cardW - 2 * $padX, 2.6, $ln, 0, 0, 'L');
            $cy += 2.6;
        }
    }
    if ($info['multiplo'] > 1) {
        $pdf->SetFont('Jost', '', 5.8);
        $pdf->SetTextColor(120, 112, 106);
        $pdf->SetXY($x + $padX, $cy + 0.3);
        $pdf->Cell($cardW - 2 * $padX, 2.6, 'Se pide de a ' . $info['multiplo'] . ' u.', 0, 0, 'L');
        $cy += 3;
    }
    // precio (siempre pegado abajo de la card)
    $py = $y + $rowH - 7.6;
    $pdf->SetFont('Jost', 'B', 11.5);
    $pdf->SetTextColor(23, 20, 18);
    $txt = pdf_fmt_precio($p['precio_mayorista']);
    $w = $pdf->GetStringWidth($txt) + 1;
    $pdf->SetXY($x + $padX, $py);
    $pdf->Cell($w, 5, $txt, 0, 0, 'L');
    $pdf->SetFont('JostSB', '', 5.8);
    $pdf->SetTextColor(120, 112, 106);
    $pdf->SetXY($x + $padX + $w, $py + 1.2);
    $pdf->Cell(10, 3.6, '+ IVA', 0, 0, 'L');
}

if (!$productos) {
    $pdf->SetFont('Jost', '', 11);
    $pdf->SetTextColor(120, 112, 106);
    $pdf->SetXY(CatalogoPDF::MX, $pdf->GetY() + 10);
    $pdf->Cell(190, 8, 'Esta preventa todavía no tiene productos disponibles.', 0, 1, 'L');
} else {
    $y = $pdf->GetY();
    $categoria = null;
    $i = 0; $n = count($productos);
    while ($i < $n) {
        $p = $productos[$i];
        // Título de categoría (con la barra naranja del catálogo)
        if ($p['categoria'] !== $categoria) {
            $categoria = $p['categoria'];
            $primera = card_info($pdf, $p, $colores, $cardW, $padX);
            if ($y + 12 + $primera['h'] > $limiteY) { $pdf->AddPage(); $y = $pdf->GetY(); }
            $y += 2;
            $pdf->SetFillColor(232, 78, 27);
            $pdf->Rect(CatalogoPDF::MX, $y, 1.2, 5.2, 'F');
            $pdf->SetFont('Jost', 'B', 11);
            $pdf->SetTextColor(232, 78, 27);
            $pdf->SetXY(CatalogoPDF::MX + 3, $y);
            $pdf->Cell(150, 5.2, mb_strtoupper((string)$categoria, 'UTF-8'), 0, 0, 'L');
            $y += 8;
        }
        // Fila de hasta 4 cards de la misma categoría
        $fila = [];
        while ($i < $n && count($fila) < $COLS && $productos[$i]['categoria'] === $categoria) {
            $fila[] = [$productos[$i], card_info($pdf, $productos[$i], $colores, $cardW, $padX)];
            $i++;
        }
        $rowH = 0;
        foreach ($fila as $f) $rowH = max($rowH, $f[1]['h']);
        if ($y + $rowH > $limiteY) { $pdf->AddPage(); $y = $pdf->GetY(); }
        foreach ($fila as $k => $f) {
            $x = CatalogoPDF::MX + $k * ($cardW + $GAP);
            dibujar_card($pdf, $f[0], $f[1], $x, $y, $cardW, $padX, $rowH);
        }
        $y += $rowH + $GAP;
    }
}

$tmp = $archivo . '.tmp' . getmypid();
$pdf->Output('F', $tmp);
// Se borran los PDF viejos de esta preventa y se publica el nuevo de forma atómica.
foreach (glob($dirPdf . '/' . $idPv . '_*.pdf') ?: [] as $viejo) @unlink($viejo);
rename($tmp, $archivo);
if ($lock) { flock($lock, LOCK_UN); fclose($lock); }
pdf_enviar($archivo, $nombreDescarga);
