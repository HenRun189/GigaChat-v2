<?php
session_start();
$debug = (isset($_SESSION['user_id']) && (int)$_SESSION['user_id'] === 1 && isset($_GET['debug']));
error_reporting(E_ALL);
ini_set('display_errors', $debug ? '1' : '0');
ini_set('log_errors', '1');
ini_set('error_log', __DIR__ . '/php-error.log');

if(!isset($_SESSION['user_id'])) exit;

$user_id = intval($_SESSION['user_id']);
$group_id = isset($_GET['group_id']) ? intval($_GET['group_id']) : 0;

require_once __DIR__ . '/../../core/db.php';
$conn = get_db();

// Mitglied austragen (prepared statement to prevent SQL injection)
$stmt = $conn->prepare("DELETE FROM group_members WHERE user_id = ? AND group_id = ?");
$stmt->bind_param("ii", $user_id, $group_id);
$stmt->execute();
$stmt->close();
$conn->close();

echo "OK";
