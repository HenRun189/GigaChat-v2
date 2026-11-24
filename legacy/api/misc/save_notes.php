<?php
session_start();
if (!isset($_SESSION['user_id'])) exit;

require_once __DIR__ . '/../../core/db.php';
$conn = get_db();

$uid = (int)$_SESSION['user_id'];
$content = $_POST['content'] ?? "";

$stmt = $conn->prepare("
  INSERT INTO user_notes (user_id, content)
  VALUES (?, ?)
  ON DUPLICATE KEY UPDATE content=VALUES(content)
");
$stmt->bind_param("is", $uid, $content);
$stmt->execute();

echo "ok";
