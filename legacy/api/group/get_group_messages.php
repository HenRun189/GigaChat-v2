<?php
session_start();

error_reporting(E_ALL);
ini_set('display_errors', (isset($_SESSION['user_id']) && (int)$_SESSION['user_id'] === 1 && isset($_GET['debug'])) ? '1' : '0');
ini_set('log_errors', 1);
ini_set('error_log', __DIR__ . '/php-error.log');

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode([]);
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

$user_id  = (int)$_SESSION['user_id'];
$group_id = (int)($_GET['group_id'] ?? 0);
$last_id  = (int)($_GET['last_id'] ?? 0);
$before_id = (int)($_GET['before_id'] ?? 0);
$limit    = min(50, (int)($_GET['limit'] ?? 50));

// Security: Verify user is a member of this group
$memberCheck = $conn->prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? LIMIT 1");
$memberCheck->bind_param("ii", $group_id, $user_id);
$memberCheck->execute();
$memberCheck->store_result();
if ($memberCheck->num_rows === 0) {
    http_response_code(403);
    echo json_encode(["error" => "forbidden"]);
    $memberCheck->close();
    exit;
}
$memberCheck->close();

// ACHTUNG: bind_param() bindet die Werte IN DER REIHENFOLGE der ?-Platzhalter
// IM SQL-TEXT (ua.owner_id steht VOR dem WHERE!). Reihenfolge dort:
//   1 = ua.owner_id, 2 = gm.group_id, 3 = Cursor (last_id/before_id, optional), 4 = LIMIT
$conditions = "WHERE gm.group_id = ?";
$types = "ii";
$params = [$user_id, $group_id];

if ($last_id > 0) {
    $conditions .= " AND gm.id > ?";
    $types .= "i";
    $params[] = $last_id;
    $order = 'ORDER BY gm.id ASC';
} elseif ($before_id > 0) {
    $conditions .= " AND gm.id < ?";
    $types .= "i";
    $params[] = $before_id;
    $order = 'ORDER BY gm.id DESC';
} else {
    // A chat opens at the newest page; the response is reversed below for display.
    $order = 'ORDER BY gm.id DESC';
}

$sql = "
SELECT 
    gm.id,
    gm.sender_id,
    gm.message,
    gm.gif_url,
    gm.created_at,
    gm.edited,
    gm.deleted,
    COALESCE(NULLIF(ua.alias,''), u.username) AS display_name,
    u.color,
    u.emoji,
    gf.path AS file_path,
    gf.is_image,
    gf.original_name
FROM group_messages gm
JOIN users u ON gm.sender_id = u.id
LEFT JOIN user_aliases ua
  ON ua.owner_id = ? AND ua.target_id = u.id
LEFT JOIN group_message_files gf
  ON gf.message_id = gm.id
  AND gf.id = (SELECT MIN(id) FROM group_message_files WHERE message_id = gm.id)
  $conditions
$order
LIMIT ?
";
$types .= "i";
$params[] = $limit;

$stmt = $conn->prepare($sql);
$stmt->bind_param($types, ...$params);
$stmt->execute();
$result = $stmt->get_result();
if (!$result) {
    http_response_code(500);
    echo json_encode(["error" => $conn->error]);
    exit;
}

$messages = [];
while ($row = $result->fetch_assoc()) {
  $messages[] = [
      "id"         => (int)$row['id'],
      "sender_id"  => (int)$row['sender_id'],
      "username"   => htmlspecialchars($row['display_name'], ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'),
      "text"       => htmlspecialchars($row['message'], ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'),
      "gif_url"    => htmlspecialchars($row['gif_url'], ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'),
      "created_at" => $row['created_at'],
      // color/emoji/file_path/original_name fließen im Client in innerHTML
      // (Template-Literale) und müssen daher serverseitig escaped werden.
      "color"      => htmlspecialchars($row['color'], ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'),
      "emoji"      => htmlspecialchars($row['emoji'], ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'),
      "file_path"  => htmlspecialchars($row['file_path'], ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'),
      "is_image"   => (int)$row['is_image'],
      "original_name" => htmlspecialchars($row['original_name'], ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'),
      "edited"     => (int)$row['edited'],
      "deleted"    => (int)$row['deleted'],
  ];
}

if ($before_id > 0 || $last_id === 0) {
    $messages = array_reverse($messages);
}

header('Content-Type: application/json; charset=utf-8');
echo json_encode($messages, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
$stmt->close();
$conn->close();
