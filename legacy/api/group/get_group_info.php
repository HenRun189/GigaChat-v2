<?php
session_start();
$debug = (isset($_SESSION['user_id']) && (int)$_SESSION['user_id'] === 1 && isset($_GET['debug']));
error_reporting(E_ALL);
ini_set('display_errors', $debug ? '1' : '0');
ini_set('log_errors', '1');
ini_set('error_log', __DIR__ . '/php-error.log');

if (!isset($_SESSION['user_id'])) {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'not_logged_in']);
    exit;
}

$user_id  = (int)$_SESSION['user_id'];
$group_id = isset($_GET['group_id']) ? (int)$_GET['group_id'] : 0;

require_once __DIR__ . '/../../core/db.php';
try {
    $conn = get_db();
} catch (RuntimeException $e) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'db_error']);
    exit;
}

// Sicherheit: nur Mitglieder dürfen Infos zu einer Gruppe abrufen
$memberCheck = $conn->prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? LIMIT 1");
$memberCheck->bind_param("ii", $group_id, $user_id);
$memberCheck->execute();
$memberCheck->store_result();
if ($memberCheck->num_rows === 0) {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'forbidden']);
    $memberCheck->close();
    $conn->close();
    exit;
}
$memberCheck->close();

$sql = "SELECT id, name, created_by FROM chat_groups WHERE id = ?";
$stmt = $conn->prepare($sql);
$stmt->bind_param("i", $group_id);
$stmt->execute();
$res = $stmt->get_result();
$group = $res->fetch_assoc();
$stmt->close();

if (!$group) {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'not_found']);
    $conn->close();
    exit;
}

$group['is_owner'] = ($group['created_by'] == $user_id);
header('Content-Type: application/json; charset=utf-8');
echo json_encode($group);
$conn->close();
