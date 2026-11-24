<?php
session_start();
header('Content-Type: application/json');

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(['error' => 'not_logged_in']);
    exit;
}

require_once __DIR__ . '/../core/db.php';
try {
    $conn = get_db();
} catch (RuntimeException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'db_error']);
    exit;
}

$result = $conn->query("
SELECT username,pixels_set 
FROM users
ORDER BY pixels_set DESC
LIMIT 10
");

$data=[];

while($row=$result->fetch_assoc()){
$data[]=$row;
}

echo json_encode($data);