<?php
session_start();
$debug = (isset($_SESSION['user_id']) && (int)$_SESSION['user_id'] === 1 && isset($_GET['debug']));
error_reporting(E_ALL);
ini_set('display_errors', $debug ? '1' : '0');
ini_set('log_errors', '1');
ini_set('error_log', __DIR__ . '/php-error.log');

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo "Nicht eingeloggt!";
    exit;
}


require_once __DIR__ . '/../../core/db.php';
try {
    $conn = get_db();
} catch (RuntimeException $e) {
    http_response_code(500);
    echo json_encode([]);
    exit;
}

$user_id = intval($_SESSION['user_id']);
$chat_with = isset($_GET['user_id']) ? intval($_GET['user_id']) : 0;
$last_id   = isset($_GET['last_id']) ? intval($_GET['last_id']) : 0;
$before_id= isset($_GET['before_id']) ? intval($_GET['before_id']) : 0;
$limit     = isset($_GET['limit']) ? min(50, intval($_GET['limit'])) : 30;

// Build query with prepared statements to prevent SQL injection
// ACHTUNG: bind_param() bindet die Werte IN DER REIHENFOLGE der ?-Platzhalter
// IM SQL-TEXT. Reihenfolge dort:
//   1 = ua.owner_id, 2 = m.sender_id (ich), 3 = m.receiver_id (Chat-Partner),
//   4 = m.sender_id (Chat-Partner), 5 = m.receiver_id (ich),
//   6 = Cursor (last_id/before_id, optional), 7 = LIMIT
$conditions = "
  ((m.sender_id = ? AND m.receiver_id = ?)
   OR
   (m.sender_id = ? AND m.receiver_id = ?))
";
$types = "iiiii";
$params = [$user_id, $user_id, $chat_with, $chat_with, $user_id];

if ($last_id > 0) {
    $conditions .= " AND m.id > ?";
    $types .= "i";
    $params[] = $last_id;
    $order = "ORDER BY m.id ASC";
} elseif ($before_id > 0) {
    $conditions .= " AND m.id < ?";
    $types .= "i";
    $params[] = $before_id;
    $order = "ORDER BY m.id DESC";
} else {
    $order = "ORDER BY m.id DESC";
}

$sql = "
SELECT 
    m.*,
    m.gif_url,
    COALESCE(NULLIF(ua.alias,''), u.username) AS display_name,
    u.color,
    u.emoji,
    f.path          AS file_path,
    f.is_image      AS is_image,
    f.original_name AS original_name
    FROM messages m
    JOIN users u ON m.sender_id = u.id
    LEFT JOIN user_aliases ua 
      ON ua.owner_id = ? AND ua.target_id = u.id
    LEFT JOIN message_files f
      ON f.message_id = m.id
      AND f.id = (SELECT MIN(id) FROM message_files WHERE message_id = m.id)
    WHERE $conditions
    $order
    LIMIT ?
";
$types .= "i";
$params[] = $limit;

$stmt = $conn->prepare($sql);
$stmt->bind_param($types, ...$params);
$stmt->execute();
$result = $stmt->get_result();
$messages = [];
while($row = $result->fetch_assoc()){
    $messages[] = [
        "id"           => $row['id'],
        "sender_id"    => $row['sender_id'],
        "username"     => htmlspecialchars($row['display_name'], ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'),
        "text"         => htmlspecialchars($row['message'], ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'),
        "gif_url"      => htmlspecialchars($row['gif_url'], ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'),
        "created_at"   => $row['created_at'],
        // color/emoji/file_path/original_name fließen im Client in innerHTML
        // (Template-Literale) und müssen daher serverseitig escaped werden.
        "color"        => htmlspecialchars($row['color'], ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'),
        "emoji"        => htmlspecialchars($row['emoji'], ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'),
        "read_at"      => $row['read_at'],
        "file_path"    => htmlspecialchars($row['file_path'], ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'),
        "is_image"     => (int)$row['is_image'],
        "original_name"=> htmlspecialchars($row['original_name'], ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'),
        "edited"       => (int)$row['edited'],
        "deleted"      => (int)$row['deleted'],
    ];
}

if ($before_id > 0 || $last_id === 0) {
    $messages = array_reverse($messages);
}

header('Content-Type: application/json; charset=utf-8');
echo json_encode($messages, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
$stmt->close();
$conn->close();
