<?php
session_start();
header('Content-Type: application/json');

if (!isset($_SESSION['user_id'])) {
  http_response_code(401);
  echo json_encode(['ok' => false]);
  exit;
}

require_once __DIR__ . '/../../core/db.php';
try {
    $conn = get_db();
} catch (RuntimeException $e) {
    http_response_code(500);
    echo json_encode(['ok' => false]);
    exit;
}

$uid = (int)$_SESSION['user_id'];
$stmt = $conn->prepare("UPDATE users SET last_seen = NOW() WHERE id = ?");
$stmt->bind_param("i", $uid);
$stmt->execute();
$stmt->close();
$conn->close();

echo json_encode(['ok' => true]);
