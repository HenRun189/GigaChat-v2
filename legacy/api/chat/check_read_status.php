<?php
session_start();
header('Content-Type: application/json; charset=utf-8');

if (!isset($_SESSION['user_id'])) {
    echo json_encode([]);
    exit;
}

require_once __DIR__ . '/../../core/db.php';
try {
    $conn = get_db();
} catch (RuntimeException $e) {
    http_response_code(500);
    echo json_encode([]);
    exit;
}
$user = (int)$_SESSION['user_id'];

// Nur kürzlich gelesene Nachrichten liefern. Das vollständige Set wird bereits
// über get_messages (read_at) beim Initial-Laden gerendert; hier geht es nur
// ums Live-Update, daher ein Zeitfenster reicht und hält die Antwort klein.
$stmt = $conn->prepare("
  SELECT id
  FROM messages
  WHERE sender_id = ?
    AND read_at IS NOT NULL
    AND read_at > (NOW() - INTERVAL 5 MINUTE)
  LIMIT 200
");
$stmt->bind_param("i", $user);
$stmt->execute();
$res = $stmt->get_result();

$ids = [];
while ($r = $res->fetch_assoc()) {
    $ids[] = (int)$r['id'];
}
$stmt->close();
$conn->close();

echo json_encode($ids);
