<?php
session_start();
header('Content-Type: application/json; charset=utf-8');
if (!isset($_SESSION['user_id'])) {
    echo json_encode(['error' => 'not_logged_in']);
    exit;
}

$user_id  = (int)$_SESSION['user_id'];
$group_id = (int)($_GET['group_id'] ?? 0);
if (!$group_id) {
    echo json_encode(['error' => 'bad_group']);
    exit;
}

require_once __DIR__ . '/../../core/db.php';
try {
    $conn = get_db();
} catch (RuntimeException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'DB_ERROR']);
    exit;
}

// Sicherheit: nur Mitglieder dürfen die Lesestatus einer Gruppe updaten
$memberCheck = $conn->prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? LIMIT 1");
$memberCheck->bind_param("ii", $group_id, $user_id);
$memberCheck->execute();
$memberCheck->store_result();
if ($memberCheck->num_rows === 0) {
    echo json_encode(['error' => 'forbidden']);
    $memberCheck->close();
    $conn->close();
    exit;
}
$memberCheck->close();

// Letzte Nachricht-ID der Gruppe (prepared)
$stmt = $conn->prepare("SELECT MAX(id) AS last_id FROM group_messages WHERE group_id = ?");
$stmt->bind_param("i", $group_id);
$stmt->execute();
$res = $stmt->get_result();
$lastId = (int)($res->fetch_assoc()['last_id'] ?? 0);
$stmt->close();

$stmt = $conn->prepare("
  INSERT INTO group_reads (user_id, group_id, last_read_msg_id, first_read_at)
  VALUES (?, ?, ?, NOW())
  ON DUPLICATE KEY UPDATE
    last_read_msg_id = GREATEST(last_read_msg_id, VALUES(last_read_msg_id)),
    first_read_at = IF(first_read_at IS NULL, NOW(), first_read_at)
");
$stmt->bind_param("iii", $user_id, $group_id, $lastId);
$stmt->execute();
$stmt->close();
$conn->close();

echo json_encode(['ok' => true]);

