<?php
session_start();
if (!isset($_SESSION['user_id'])) exit;

require_once __DIR__ . '/../../core/db.php';
try {
    $conn = get_db();
} catch (RuntimeException $e) {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['content' => '']);
    exit;
}
$uid = (int)$_SESSION['user_id'];

$stmt = $conn->prepare("SELECT content FROM user_notes WHERE user_id=?");
$stmt->bind_param("i",$uid);
$stmt->execute();
$res = $stmt->get_result()->fetch_assoc();

echo json_encode([
  "content" => $res['content'] ?? ""
]);
