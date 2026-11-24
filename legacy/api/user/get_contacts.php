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
    header('Content-Type: application/json');
    echo json_encode([]);
    exit;
}

$current_chat = isset($_GET['current_chat']) ? (int)$_GET['current_chat'] : 0;
$user_id      = (int)$_SESSION['user_id'];

$contacts = [];

/*
 * USER-KONTAKTE
 * - pinned zuerst
 * - normale
 * - archivierte (für „Archiv“-Bereich)
 * - innerhalb jeder Gruppe nach letzter Nachricht
 */
// WICHTIG: ungelesener Zähler kommt direkt mit (kein N+1-Problem mehr).
$sqlUsers = "
    SELECT
        u.id,
        u.username,
        ua.alias,
        u.color,
        u.emoji,
        u.gigascore,
        COALESCE(ua.pinned, 0)   AS pinned,
        COALESCE(ua.archived, 0) AS archived,
        (
            SELECT MAX(m.created_at)
            FROM messages m
            WHERE (m.sender_id = u.id AND m.receiver_id = ?)
               OR (m.sender_id = ? AND m.receiver_id = u.id)
        ) AS last_msg_at,
        (
            SELECT COUNT(*)
            FROM messages m
            WHERE m.sender_id = u.id
              AND m.receiver_id = ?
              AND m.read_at IS NULL
        ) AS unread_cnt
    FROM users u
    LEFT JOIN user_aliases ua
        ON ua.owner_id = ? AND ua.target_id = u.id
    WHERE u.id != ?
    ORDER BY
        COALESCE(ua.archived, 0) ASC,          -- 0 oben, 1 Archiv
        COALESCE(ua.pinned, 0)  DESC,          -- pinned ganz oben
        CASE WHEN last_msg_at IS NULL THEN 2 ELSE 1 END ASC,
        last_msg_at DESC,
        u.id ASC
";

$stmt = $conn->prepare($sqlUsers);
// Reihenfolge im SQL: 2x last_msg_at, 1x unread_cnt, 1x ua.owner_id, 1x u.id
$stmt->bind_param("iiiii", $user_id, $user_id, $user_id, $user_id, $user_id);
$stmt->execute();
$res = $stmt->get_result();

while ($row = $res->fetch_assoc()) {
    // ungelesene Nachrichten (nur wenn nicht aktuell offen)
    $newCount = 0;
    if ($current_chat != (int)$row['id'] && (int)$row['archived'] === 0) {
        $newCount = (int)$row['unread_cnt'];
    }

        $contacts[] = [
        'id'        => (int)$row['id'],
        'username'  => htmlspecialchars($row['alias'] ?: $row['username'], ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'),
        'new'       => $newCount,
        'type'      => 'user',
        'color'     => htmlspecialchars($row['color'], ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'),
        'emoji'     => htmlspecialchars($row['emoji'], ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'),
        'pinned'    => (int)$row['pinned'],
        'archived'  => (int)$row['archived'],
        'last_msg'  => $row['last_msg_at'],
        'gigascore' => (int)($row['gigascore'] ?? 0),
    ];
}
$stmt->close();

$sqlGroups = "
    SELECT
        g.id,
        g.name,
        (
            SELECT COUNT(*)
            FROM group_messages gm
            LEFT JOIN group_reads gr
              ON gr.group_id = g.id
              AND gr.user_id = ?
            WHERE gm.group_id = g.id
              AND gm.sender_id != ?
              AND (
                   gr.last_read_msg_id IS NULL
                   OR gm.id > gr.last_read_msg_id
              )
        ) AS new
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
$conn->close();

header('Content-Type: application/json; charset=utf-8');
echo json_encode($contacts, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
