<?php
session_start();
header('Content-Type: application/json');

if (!isset($_SESSION['user_id'])) exit;

require_once __DIR__ . '/../../core/db.php';
try {
    $conn = get_db();
} catch (RuntimeException $e) {
    http_response_code(500);
    echo json_encode([
        "online"     => false,
        "seconds"    => null,
        "lastSeenTs" => null
    ]);
    exit;
}

$uid = (int)($_GET['user_id'] ?? 0);

$stmt = $conn->prepare("
  SELECT
    UNIX_TIMESTAMP(last_seen) AS lastSeenTs,
    TIMESTAMPDIFF(SECOND, last_seen, NOW()) AS seconds
  FROM users
  WHERE id = ?
");
$stmt->bind_param("i", $uid);
$stmt->execute();
$res = $stmt->get_result();

$row = $res->fetch_assoc();
$stmt->close();
$conn->close();

$seconds = $row['seconds'] ?? null;
$lastSeenTs = $row['lastSeenTs'] ?? null;

$online = ($seconds !== null && $seconds <= 30);

echo json_encode([
  "online"     => $online,
  "seconds"    => $seconds,
  "lastSeenTs" => $lastSeenTs
]);
