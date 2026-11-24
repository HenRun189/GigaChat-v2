<?php
session_start();
header('Content-Type: application/json; charset=utf-8');

// Debug nur fuer User 1 mit ?debug=1 – verhindert sichtbare Warnungen am Client
$debug = (isset($_SESSION['user_id']) && (int)$_SESSION['user_id'] === 1 && isset($_GET['debug']));
error_reporting(E_ALL);
ini_set('display_errors', $debug ? '1' : '0');

/*
 * GigaChat - Unified Sync Endpoint
 *
 * Liefert in EINEM Request alles, was der Client-Live-Loop braucht:
 *   - neue Nachrichten des offenen Chats (oder Initial-Seite via init=1)
 *   - komplette Kontaktliste inkl. Unread-Counts (ersetzt get_contacts-Polling)
 *   - Lesebestaetigungen der eigenen Nachrichten (ersetzt check_read_status)
 *   - Online-Status des Chat-Partners (ersetzt get_user_status)
 *   - Presence-Update des eigenen Users (ersetzt ping.php)
 *
 * Params: chat_id, type (user|group), last_id, init (0|1), limit
 */

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'not_logged_in']);
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

$user_id  = (int)$_SESSION['user_id'];
$chat_id  = (int)($_GET['chat_id'] ?? 0);
$type     = ($_GET['type'] ?? 'user') === 'group' ? 'group' : 'user';
$last_id  = (int)($_GET['last_id'] ?? 0);
$init     = (int)($_GET['init'] ?? 0);
$full     = (int)($_GET['full'] ?? 0); // 1 = Kontakte/Partner inkludieren (alle ~15s)
$limit    = min(50, max(5, (int)($_GET['limit'] ?? 50)));

/* ===== 1) Presence-Update (ersetzt ping.php) ===== */
$stmt = $conn->prepare("UPDATE users SET last_seen = NOW() WHERE id = ?");
$stmt->bind_param("i", $user_id);
$stmt->execute();
$stmt->close();

/* ===== 2) Nachrichten ===== */
$messages = [];
$hasMore  = false;

if ($chat_id > 0) {
    $isGroup = ($type === 'group');

    if ($isGroup) {
        // Security: nur Mitglieder duerfen Gruppen-Nachrichten lesen
        $mc = $conn->prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? LIMIT 1");
        $mc->bind_param("ii", $chat_id, $user_id);
        $mc->execute();
        $mc->store_result();
        $isMember = $mc->num_rows > 0;
        $mc->close();
        if (!$isMember) {
            echo json_encode(['ok' => false, 'error' => 'forbidden']);
            exit;
        }
    }

    // Cursor: init=1 holt die LETZTE Seite (DESC, limit+1 fuer hasMore-Erkennung),
    // sonst alle Nachrichten NEUER als last_id (ASC).
    if ($isGroup) {
        $sql = "
            SELECT gm.id, gm.sender_id, gm.message, gm.gif_url, gm.created_at, gm.edited, gm.deleted,
                   COALESCE(NULLIF(ua.alias,''), u.username) AS display_name,
                   u.color, u.emoji,
                   gf.path AS file_path, gf.is_image, gf.original_name
            FROM group_messages gm
            JOIN users u ON gm.sender_id = u.id
            LEFT JOIN user_aliases ua
              ON ua.owner_id = ? AND ua.target_id = u.id
            LEFT JOIN group_message_files gf
              ON gf.message_id = gm.id
              AND gf.id = (SELECT MIN(id) FROM group_message_files WHERE message_id = gm.id)
            WHERE gm.group_id = ?
        ";
        $types = "ii";
        $params = [$user_id, $chat_id];
    } else {
        $sql = "
            SELECT m.id, m.sender_id, m.message, m.gif_url, m.created_at, m.edited, m.deleted,
                   COALESCE(NULLIF(ua.alias,''), u.username) AS display_name,
                   u.color, u.emoji,
                   m.read_at,
                   f.path AS file_path, f.is_image, f.original_name
            FROM messages m
            JOIN users u ON m.sender_id = u.id
            LEFT JOIN user_aliases ua
              ON ua.owner_id = ? AND ua.target_id = u.id
            LEFT JOIN message_files f
              ON f.message_id = m.id
              AND f.id = (SELECT MIN(id) FROM message_files WHERE message_id = m.id)
            WHERE ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
        ";
        $types = "iiiii";
        $params = [$user_id, $user_id, $chat_id, $chat_id, $user_id];
    }

    // Cursor: init=1 holt die LETZTE Seite (client sendet limit+1 fuer hasMore),
    // sonst alle Nachrichten NEUER als last_id (ASC).
    $idCol = $isGroup ? 'gm.id' : 'm.id';

    if ($init) {
        $types .= "i";
        $params[] = $limit;
        $sql .= " ORDER BY $idCol DESC LIMIT ?";
    } else {
        $types .= "ii";
        $params[] = $last_id;
        $params[] = $limit;
        $sql .= " AND $idCol > ? ORDER BY $idCol ASC LIMIT ?";
    }

    $stmt = $conn->prepare($sql);
    $stmt->bind_param($types, ...$params);
    $stmt->execute();
    $res = $stmt->get_result();

    while ($row = $res->fetch_assoc()) {
        $messages[] = [
            "id"            => (int)$row['id'],
            "sender_id"     => (int)$row['sender_id'],
            "username"      => htmlspecialchars($row['display_name'] ?? '', ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'),
            "text"          => htmlspecialchars($row['message'] ?? '', ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'),
            "gif_url"       => htmlspecialchars($row['gif_url'] ?? '', ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'),
            "created_at"    => $row['created_at'],
            // color/emoji/file_path/original_name fliessen im Client in innerHTML
            // (Template-Literale) und muessen daher serverseitig escaped werden.
            "color"         => htmlspecialchars($row['color'] ?? '', ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'),
            "emoji"         => htmlspecialchars($row['emoji'] ?? '', ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'),
            "read_at"       => $row['read_at'] ?? null,
            "file_path"     => htmlspecialchars($row['file_path'] ?? '', ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'),
            "is_image"      => (int)($row['is_image'] ?? 0),
            "original_name" => htmlspecialchars($row['original_name'] ?? '', ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'),
            "edited"        => (int)($row['edited'] ?? 0),
            "deleted"       => (int)($row['deleted'] ?? 0),
        ];
    }
    $stmt->close();

    if ($init) {
        // $messages ist aktuell DESC (neueste zuerst)
        $hasMore = count($messages) >= $limit; // Seite voll -> vermutlich mehr
        $messages = array_reverse($messages);  // -> ASC fuer die Anzeige
    }
}

/* ===== 3) Kontakte + Gruppen – nur bei full=1 (jeder 3. Sync) ===== */
$contacts = [];

if ($full) {
$sqlUsers = "
    SELECT u.id, u.username, ua.alias, u.color, u.emoji, u.gigascore,
           COALESCE(ua.pinned, 0)   AS pinned,
           COALESCE(ua.archived, 0) AS archived,
           (SELECT MAX(m.created_at) FROM messages m
             WHERE (m.sender_id = u.id AND m.receiver_id = ?)
                OR (m.sender_id = ? AND m.receiver_id = u.id)) AS last_msg_at,
           (SELECT COUNT(*) FROM messages m
             WHERE m.sender_id = u.id AND m.receiver_id = ? AND m.read_at IS NULL) AS unread_cnt
    FROM users u
    LEFT JOIN user_aliases ua ON ua.owner_id = ? AND ua.target_id = u.id
    WHERE u.id != ?
    ORDER BY COALESCE(ua.archived, 0) ASC, COALESCE(ua.pinned, 0) DESC,
             CASE WHEN last_msg_at IS NULL THEN 2 ELSE 1 END ASC,
             last_msg_at DESC, u.id ASC
";
$stmt = $conn->prepare($sqlUsers);
$stmt->bind_param("iiiii", $user_id, $user_id, $user_id, $user_id, $user_id);
$stmt->execute();
$res = $stmt->get_result();
while ($row = $res->fetch_assoc()) {
    $newCount = 0;
    if ($chat_id != (int)$row['id'] && (int)$row['archived'] === 0) {
        $newCount = (int)$row['unread_cnt'];
    }
    $contacts[] = [
        'id'        => (int)$row['id'],
        'username'  => htmlspecialchars($row['alias'] ?: $row['username'], ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'),
        'new'       => $newCount,
        'type'      => 'user',
        'color'     => htmlspecialchars($row['color'] ?? '', ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'),
        'emoji'     => htmlspecialchars($row['emoji'] ?? '', ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'),
        'pinned'    => (int)$row['pinned'],
        'archived'  => (int)$row['archived'],
        'last_msg'  => $row['last_msg_at'],
        'gigascore' => (int)($row['gigascore'] ?? 0),
    ];
}
$stmt->close();

$sqlGroups = "
    SELECT g.id, g.name,
           (SELECT COUNT(*) FROM group_messages gm
             LEFT JOIN group_reads gr ON gr.group_id = g.id AND gr.user_id = ?
             WHERE gm.group_id = g.id AND gm.sender_id != ?
               AND (gr.last_read_msg_id IS NULL OR gm.id > gr.last_read_msg_id)) AS new
    FROM chat_groups g
    JOIN group_members gm2 ON gm2.group_id = g.id
    WHERE gm2.user_id = ?
";
$stmt = $conn->prepare($sqlGroups);
$stmt->bind_param("iii", $user_id, $user_id, $user_id);
$stmt->execute();
$groups = $stmt->get_result();
while ($g = $groups->fetch_assoc()) {
    $contacts[] = [
        'id'       => (int)$g['id'],
        'username' => $g['name'],
        'new'      => (int)$g['new'],
        'type'     => 'group',
        'color'    => null,
        'emoji'    => null,
        'pinned'   => 0,
        'archived' => 0,
        'last_msg' => null,
    ];
}
$stmt->close();
} // Ende if($full) – Kontakte/Gruppen

/* ===== 4) Lesebestaetigungen (kostenguenstig, jeder Sync) ===== */
$readIds = [];
$stmt = $conn->prepare("
    SELECT id FROM messages
    WHERE sender_id = ? AND read_at IS NOT NULL AND read_at > (NOW() - INTERVAL 5 MINUTE)
    LIMIT 200
");
$stmt->bind_param("i", $user_id);
$stmt->execute();
$res = $stmt->get_result();
while ($r = $res->fetch_assoc()) {
    $readIds[] = (int)$r['id'];
}
$stmt->close();

/* ===== 5) Partner-Status (wie get_user_status.php, nur bei Privatchat + full) ===== */
$partner = null;
if ($full && $type === 'user' && $chat_id > 0) {
    $stmt = $conn->prepare("
        SELECT UNIX_TIMESTAMP(last_seen) AS lastSeenTs,
               TIMESTAMPDIFF(SECOND, last_seen, NOW()) AS seconds
        FROM users WHERE id = ?
    ");
    $stmt->bind_param("i", $chat_id);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    $seconds = $row['seconds'] ?? null;
    $partner = [
        "online"     => ($seconds !== null && $seconds <= 30),
        "seconds"    => $seconds,
        "lastSeenTs" => $row['lastSeenTs'] ?? null,
    ];
}

$conn->close();

echo json_encode([
    'ok'       => true,
    'ts'       => date('Y-m-d H:i:s'),
    'messages' => $messages,
    'hasMore'  => $hasMore,
    'contacts' => $contacts,
    'readIds'  => $readIds,
    'partner'  => $partner,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);