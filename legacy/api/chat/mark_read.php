<?php
session_start();
header('Content-Type: application/json');

if (!isset($_SESSION['user_id'])) {
  http_response_code(401);
  echo json_encode(['ok' => false]);
  exit;
}

$user_id   = (int)$_SESSION['user_id'];
$chat_with = isset($_GET['user_id']) ? (int)$_GET['user_id'] : 0;

require_once __DIR__ . '/../../core/db.php';
try {
    $conn = get_db();
} catch (RuntimeException $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'DB_ERROR']);
    exit;
}

if ($chat_with > 0) {
  $stmt = $conn->prepare("
    UPDATE messages 
    SET read_at = NOW() 
    WHERE sender_id = ?
      AND receiver_id = ?
      AND read_at IS NULL
  ");
  $stmt->bind_param("ii", $chat_with, $user_id);
  $stmt->execute();
  $stmt->close();
}

$conn->close();
echo json_encode(['ok' => true]);
