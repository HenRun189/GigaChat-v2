<?php
session_start();
header('Content-Type: application/json; charset=utf-8');

if (!isset($_SESSION['user_id'])) {
    echo json_encode(['ok' => false, 'error' => 'not_logged_in']);
    exit;
}

$data = json_decode(file_get_contents("php://input"), true);

if (empty($data['endpoint']) || !is_string($data['endpoint'])) {
    echo json_encode(['ok' => false, 'error' => 'bad_request']);
    exit;
}

require_once __DIR__ . '/../../core/db.php';
try {
    $conn = get_db();
} catch (RuntimeException $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'db_error']);
    exit;
}

// Nur die eigene Subscription dürfen - Scope an user_id bilden (CSRF-Sicherheit)
$stmt = $conn->prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?");
$stmt->bind_param("si", $data['endpoint'], $_SESSION['user_id']);
$stmt->execute();
$stmt->close();
$conn->close();

echo json_encode(['ok' => true]);
