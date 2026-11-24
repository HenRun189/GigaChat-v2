<?php
session_start();
header("Content-Type: application/json");

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(['error' => 'not_logged_in']);
    exit;
}

$file = __DIR__."/updates.json";

if(!file_exists($file)){
    file_put_contents($file,json_encode([]));
}

echo file_get_contents($file);