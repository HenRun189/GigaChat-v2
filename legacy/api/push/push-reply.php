<?php
session_start();
$data = json_decode(file_get_contents("php://input"), true);
if (!$data) exit;

require_once __DIR__ . '/../../core/db.php';
try {
    $conn = get_db();
} catch (RuntimeException $e) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'db_error']);
    exit;
}

$user_id = (int)($_SESSION['user_id'] ?? 0);
$chat    = (int)($data['chat'] ?? 0);
$text    = trim($data['text'] ?? '');

if (!$user_id || !$chat || !$text) {
    http_response_code(401);
    echo json_encode(['error' => 'Nicht autorisiert']);
    exit;
}

// User-Chat
$stmt = $conn->prepare("
  INSERT INTO messages (sender_id, receiver_id, message)
  VALUES (?, ?, ?)
");
$stmt->bind_param("iis", $user_id, $chat, $text);
$stmt->execute();
$stmt->close();
$conn->close();

header('Content-Type: text/plain; charset=utf-8');
echo "ok";
