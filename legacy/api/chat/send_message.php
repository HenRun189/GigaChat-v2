<?php
session_start();
$debug = (isset($_SESSION['user_id']) && (int)$_SESSION['user_id'] === 1 && isset($_GET['debug']));
error_reporting(E_ALL);
ini_set('display_errors', $debug ? '1' : '0');
ini_set('log_errors', '1');
ini_set('error_log', __DIR__ . '/php-error.log');

require_once __DIR__ . '/../../core/config.php';

/* WebPush nur laden, wenn Composer-vendor existiert (lokal evtl. nicht installiert).
   Ohne vendor läuft das Senden weiter – nur Push wird übersprungen. */
$pushEnabled = false;
if (file_exists(__DIR__ . '/../../vendor/autoload.php')) {
    require_once __DIR__ . '/../../vendor/autoload.php';
    $pushEnabled = class_exists('Minishlink\\WebPush\\WebPush');
}
use Minishlink\WebPush\WebPush;
use Minishlink\WebPush\Subscription;

/* ===== LOGIN ===== */
if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    exit(json_encode(['ok'=>false]));
}

$sender = (int)$_SESSION['user_id'];

/* ===== DB ===== */
require_once __DIR__ . '/../../core/db.php';
try {
    $conn = get_db();
} catch (RuntimeException $e) {
    http_response_code(500);
    exit(json_encode(['ok' => false, 'error' => 'DB_ERROR']));
}

/* =================================================
   GIF (JSON)
   ================================================= */
$raw = file_get_contents("php://input");
$data = json_decode($raw, true);

if (is_array($data) && ($data['type'] ?? '') === 'gif') {

    $receiver = (int)($data['receiver_id'] ?? 0);
    $gif      = trim($data['gif_url'] ?? '');

    if (!$receiver || !$gif) {
        http_response_code(400);
        exit('BAD GIF DATA');
    }

    $stmt = $conn->prepare("
        INSERT INTO messages (sender_id, receiver_id, message, gif_url, created_at)
        VALUES (?, ?, '[gif]', ?, NOW())
    ");
    $stmt->bind_param("iis", $sender, $receiver, $gif);
$stmt->execute();
$stmt->close();

/* ===== GIGASCORE ===== */
$score = $conn->prepare("
    UPDATE users 
    SET gigascore = gigascore + 1 
    WHERE id = ?
");
$score->bind_param("i", $sender);
$score->execute();
$score->close();

/* ===== PUSH ===== */
$vapid = [
    'subject'    => VAPID_SUBJECT,
    'publicKey'  => VAPID_PUBLIC,
    'privateKey' => VAPID_PRIVATE,
];

$user = strip_tags($_SESSION['username'] ?? 'Gigachat');

if ($pushEnabled) {
$webPush = new WebPush(['VAPID' => $vapid]);

$stmtPush = $conn->prepare("
  SELECT endpoint, p256dh, auth
  FROM push_subscriptions
  WHERE user_id = ?
");
$stmtPush->bind_param("i", $receiver);
$stmtPush->execute();
$resPush = $stmtPush->get_result();

$payload = json_encode([
  'title' => 'Neue Nachricht',
  'body'  => $user . ' hat ein GIF geschickt',
  'chatId'=> $sender,
  'type'  => 'user'
]);

while ($row = $resPush->fetch_assoc()) {
    $sub = Subscription::create([
        'endpoint'  => $row['endpoint'],
        'publicKey' => $row['p256dh'],
        'authToken' => $row['auth'],
    ]);
    $webPush->queueNotification($sub, $payload);
}
$stmtPush->close();

foreach ($webPush->flush() as $report) {
    if (!$report->isSuccess() && $report->isSubscriptionExpired()) {
        $ep = $report->getEndpoint();
        $del = $conn->prepare("DELETE FROM push_subscriptions WHERE endpoint = ?");
        $del->bind_param('s', $ep);
        $del->execute();
        $del->close();
    }
}
}

$conn->close();
echo json_encode(['ok'=>true]);
exit;

}

/* =================================================
   TEXT (POST)
   ================================================= */
if (!isset($_POST['receiver_id'], $_POST['message'])) {
    http_response_code(400);
    exit('MISSING DATA');
}

$receiver = (int)$_POST['receiver_id'];
$message  = trim($_POST['message']);

if (strlen($message) < 1) {
    http_response_code(400);
    exit('TOO SHORT');
}

$stmt = $conn->prepare("
    INSERT INTO messages (sender_id, receiver_id, message, created_at)
    VALUES (?, ?, ?, NOW())
");
$stmt->bind_param("iis", $sender, $receiver, $message);
$stmt->execute();
$stmt->close();

/* ===== GIGASCORE ===== */
$score = $conn->prepare("
    UPDATE users
SET gigascore = gigascore + 1
WHERE id IN (?, ?)

");
$score->bind_param("ii", $sender, $receiver);
$score->execute();
$score->close();

/* ===== PUSH ===== */
$vapid = [
    'subject'    => VAPID_SUBJECT,
    'publicKey'  => VAPID_PUBLIC,
    'privateKey' => VAPID_PRIVATE,
];

$senderName = $_SESSION['username'] ?? 'Unbekannt';

if ($pushEnabled) {
$webPush = new WebPush(['VAPID' => $vapid]);

$stmt = $conn->prepare("
  SELECT endpoint, p256dh, auth
  FROM push_subscriptions
  WHERE user_id = ?
");
$stmt->bind_param("i", $receiver);
$stmt->execute();
$res = $stmt->get_result();

$text = trim($message);
if ($text === '') {
    $text = 'Nachricht';
}

$payload = json_encode([
  'title' => 'Neue Nachricht',
  'body'  => $senderName . ': ' . mb_strimwidth($text, 0, 80, '…'),
  'chatId'=> $sender,
  'type'  => 'user'
]);


while ($row = $res->fetch_assoc()) {
    $sub = Subscription::create([
        'endpoint'  => $row['endpoint'],
        'publicKey' => $row['p256dh'],
        'authToken' => $row['auth'],
    ]);
    $webPush->queueNotification($sub, $payload);
}
$stmt->close();

foreach ($webPush->flush() as $report) {
    if (!$report->isSuccess() && $report->isSubscriptionExpired()) {
        $ep = $report->getEndpoint();
        $del = $conn->prepare("DELETE FROM push_subscriptions WHERE endpoint = ?");
        $del->bind_param('s', $ep);
        $del->execute();
    }
}
}

echo json_encode(['ok'=>true]);
exit;