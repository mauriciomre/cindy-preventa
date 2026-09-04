<?php
// Página pública de solo lectura para compartir el detalle de un pedido
// (ej. el cliente se lo reenvía a un tercero). Busca SIEMPRE por token
// random (nunca por id) y nunca expone PII del cliente — ver la nota en
// api.php junto a pedido_publico sobre por qué no reusa pedido_detalle.
require_once __DIR__ . '/db.php';
$db = getDB();

$token = trim($_GET['t'] ?? '');
$pedido = null;
if ($token) {
    $stmt = $db->prepare("SELECT p.id, p.estado, p.total, p.created_at, c.nombre as cliente_nombre
        FROM pedidos p JOIN clientes c ON p.cliente_id=c.id WHERE p.token_publico=?");
    $stmt->bind_param('s', $token);
    $stmt->execute();
    $pedido = $stmt->get_result()->fetch_assoc();
    if ($pedido) {
        $itemsStmt = $db->prepare("SELECT codigo, descripcion, cantidad, precio_unitario, subtotal, en_lista_espera, preventa_nombre, colores_detalle FROM pedido_items WHERE pedido_id=?");
        $itemsStmt->bind_param('i', $pedido['id']);
        $itemsStmt->execute();
        $pedido['items'] = $itemsStmt->get_result()->fetch_all(MYSQLI_ASSOC);
    }
}

$estados = [
    'PENDIENTE' => 'Pendiente',
    'EN_PREPARACION' => 'En preparación',
    'FACTURADO' => 'Facturado',
    'ENVIADO' => 'Enviado',
    'ELIMINADO' => 'Cancelado',
];

function h($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
function money($n) { return '$' . number_format((float)$n, 0, ',', '.'); }
?>
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Detalle de pedido</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Jost:wght@400;500;700&family=Lora:ital@0;1&display=swap" rel="stylesheet">
<style>
    :root { --blue:#e84e1b; --pale:#f6ece4; --ink:#171412; --muted:#8a8480; --border:#e8e2da; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:'Jost',sans-serif; background:var(--pale); color:var(--ink); padding:24px 16px 60px; }
    .card { max-width:600px; margin:0 auto; background:#fff; border-radius:14px; padding:28px 24px; box-shadow:0 2px 14px rgba(0,0,0,.06); }
    h1 { font-size:20px; font-weight:700; margin:0 0 4px; }
    .sub { color:var(--muted); font-size:13px; margin-bottom:20px; }
    .badge { display:inline-block; padding:4px 10px; border-radius:20px; font-size:12px; font-weight:500; background:var(--pale); color:var(--blue); }
    .grupo-tit { font-weight:500; font-size:13px; color:var(--blue); margin:20px 0 8px; text-transform:uppercase; letter-spacing:.03em; }
    table { width:100%; border-collapse:collapse; font-size:14px; }
    td { padding:8px 0; border-bottom:1px solid var(--border); vertical-align:top; }
    .desc { font-weight:500; }
    .cod { color:var(--muted); font-size:12px; }
    .cant { text-align:center; white-space:nowrap; }
    .sub-precio { text-align:right; white-space:nowrap; }
    .espera { display:inline-block; margin-top:2px; font-size:11px; color:#a35b00; background:#fdf1de; padding:2px 6px; border-radius:6px; }
    .colores { font-size:12px; color:var(--muted); margin-top:2px; }
    .total-row td { border-bottom:none; font-weight:700; font-size:16px; padding-top:14px; }
    .notfound { text-align:center; color:var(--muted); padding:40px 0; }
</style>
</head>
<body>
<div class="card">
<?php if (!$pedido): ?>
    <h1>Pedido no encontrado</h1>
    <p class="notfound">El link no es válido o el pedido ya no existe.</p>
<?php else: ?>
    <h1>Detalle de pedido</h1>
    <div class="sub">
        <?= h($pedido['cliente_nombre']) ?> · <?= h(date('d/m/Y', strtotime($pedido['created_at']))) ?>
        · <span class="badge"><?= h($estados[$pedido['estado']] ?? $pedido['estado']) ?></span>
    </div>
    <?php
    $grupos = []; $orden = [];
    foreach ($pedido['items'] as $item) {
        $g = $item['preventa_nombre'] ?: 'Catálogo general';
        if (!isset($grupos[$g])) { $grupos[$g] = []; $orden[] = $g; }
        $grupos[$g][] = $item;
    }
    foreach ($orden as $nombreGrupo): ?>
        <div class="grupo-tit"><?= h($nombreGrupo) ?></div>
        <table>
        <?php foreach ($grupos[$nombreGrupo] as $item): ?>
            <tr>
                <td>
                    <div class="desc"><?= h($item['descripcion']) ?></div>
                    <div class="cod">Cód: <?= h($item['codigo']) ?></div>
                    <?php if ($item['en_lista_espera']): ?><div class="espera">A confirmar stock</div><?php endif; ?>
                    <?php if (!empty($item['colores_detalle'])):
                        $cobj = json_decode($item['colores_detalle'], true);
                        if (is_array($cobj)): ?>
                        <div class="colores"><?= h(implode(' · ', array_map(function($k, $v) { return "$k: $v"; }, array_keys($cobj), $cobj))) ?></div>
                    <?php endif; endif; ?>
                </td>
                <td class="cant"><?= h($item['cantidad']) ?></td>
                <td class="sub-precio"><?= money($item['subtotal']) ?> + IVA</td>
            </tr>
        <?php endforeach; ?>
        </table>
    <?php endforeach; ?>
    <table>
        <tr class="total-row">
            <td colspan="2">Total</td>
            <td class="sub-precio"><?= money($pedido['total']) ?> + IVA</td>
        </tr>
    </table>
<?php endif; ?>
</div>
</body>
</html>
