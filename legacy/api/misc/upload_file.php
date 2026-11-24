<?php
session_start();
$debug = (isset($_SESSION['user_id']) && (int)$_SESSION['user_id'] === 1 && isset($_GET['debug']));
error_reporting(E_ALL);
ini_set('display_errors', $debug ? '1' : '0');
ini_set('log_errors', '1');
ini_set('error_log', __DIR__ . '/php-error.log');

/**
 * Beendet die Anfrage mit JSON-Fehler.
 */
function upload_json_error(int $status, string $error): void
{
    http_response_code($status);
    echo json_encode(['ok' => false, 'error' => $error]);
    exit;
}

if (!isset($_SESSION['user_id'])) {
    upload_json_error(401, 'not_logged_in');
}

$user_id     = (int)$_SESSION['user_id'];
$receiver_id = (int)($_POST['receiver_id'] ?? 0);
$type        = $_POST['type'] ?? 'user'; // 'user' oder 'group'

if ($receiver_id <= 0) {
    upload_json_error(400, 'bad_receiver');
}
if (!in_array($type, ['user', 'group'], true)) {
    upload_json_error(400, 'bad_type');
}

require_once __DIR__ . '/../../core/db.php';
try {
    $conn = get_db();
} catch (RuntimeException $e) {
    upload_json_error(500, 'db_error');
}

/* === Datei prüfen === */
if (empty($_FILES['file']['tmp_name'])) {
    upload_json_error(400, 'no_file');
}
if (isset($_FILES['file']['error']) && $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
    upload_json_error(400, 'upload_error');
}

// 20 MB Limit
$maxBytes = 20 * 1024 * 1024;
if ($_FILES['file']['size'] > $maxBytes) {
    upload_json_error(400, 'too_large');
}

$originalName = $_FILES['file']['name'];
$ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));

$allowedExtensions = [
    'jpg','jpeg','png','gif','webp',
    'pdf','doc','docx','xls','xlsx','ppt','pptx','txt'
];
if (!in_array($ext, $allowedExtensions, true)) {
    upload_json_error(400, 'type_not_allowed');
}

$finfo = finfo_open(FILEINFO_MIME_TYPE);
$mime  = finfo_file($finfo, $_FILES['file']['tmp_name']);
finfo_close($finfo);

/* === Gruppen-Sicherheit: Mitgliedschaft prüfen === */
if ($type === 'group') {
    $group_id = $receiver_id; // bei type=group steckt hier die group_id

    $memberCheck = $conn->prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? LIMIT 1");
    $memberCheck->bind_param("ii", $group_id, $user_id);
    $memberCheck->execute();
    $memberCheck->store_result();
    $isMember = $memberCheck->num_rows > 0;
    $memberCheck->close();

    if (!$isMember) {
        upload_json_error(403, 'not_group_member');
    }
}

/* === Ordner sicherstellen (uploads/ liegt im Projekt-Root) === */
$dir = __DIR__ . '/../../uploads';
if (!is_dir($dir)) {
    if (!@mkdir($dir, 0755, true)) {
        upload_json_error(500, 'mkdir_failed');
    }
}
if (!is_writable($dir)) {
    upload_json_error(500, 'uploads_not_writable');
}

$filename = uniqid('file_', true) . '.' . $ext;
$pathRel  = 'uploads/' . $filename;
$pathAbs  = $dir . '/' . $filename;

$isImage = 0;

/* === Bild oder Datei speichern (stabil) === */
$looksLikeImage = (strpos($mime, 'image/') === 0) || in_array($ext, ['jpg','jpeg','png','gif','webp'], true);

if ($looksLikeImage) {
    $isImage = 1;

    // Versuch: Bild verkleinern (Performance). Wenn das fehlschlägt -> Original speichern.
    $raw = @file_get_contents($_FILES['file']['tmp_name']);
    $src = $raw ? @imagecreatefromstring($raw) : false;

    if ($src !== false) {
        $w = imagesx($src);
        $h = imagesy($src);
        $max   = 1280;
        $scale = min(1, $max / max($w, $h));
        $newW  = max(1, (int)($w * $scale));
        $newH  = max(1, (int)($h * $scale));

        $dst = imagecreatetruecolor($newW, $newH);

        // Transparenz für PNG/GIF halbwegs erhalten
        imagealphablending($dst, false);
        imagesavealpha($dst, true);

        imagecopyresampled($dst, $src, 0, 0, 0, 0, $newW, $newH, $w, $h);

        $saved = false;

        // Speichere passend zum Format, sonst JPG
        if ($ext === 'png') {
            $saved = @imagepng($dst, $pathAbs, 6);
        } elseif ($ext === 'gif') {
            $saved = @imagegif($dst, $pathAbs);
        } elseif ($ext === 'webp' && function_exists('imagewebp')) {
            $saved = @imagewebp($dst, $pathAbs, 75);
        } else {
            // JPG/JPEG oder Fallback
            if (!in_array($ext, ['jpg','jpeg'], true)) {
                $ext = 'jpg';
                $filename = uniqid('file_', true) . '.jpg';
                $pathRel  = 'uploads/' . $filename;
                $pathAbs  = $dir . '/' . $filename;
            }
            $saved = @imagejpeg($dst, $pathAbs, 80);
        }

        imagedestroy($src);
        imagedestroy($dst);

        if (!$saved) {
            // Fallback: Original speichern
            if (!move_uploaded_file($_FILES['file']['tmp_name'], $pathAbs)) {
                upload_json_error(500, 'save_failed');
            }
        }
    } else {
        // GD konnte das Bild nicht lesen -> Original speichern
        if (!move_uploaded_file($_FILES['file']['tmp_name'], $pathAbs)) {
            upload_json_error(500, 'move_failed');
        }
    }
} else {
    // normale Datei: einfach speichern
    if (!move_uploaded_file($_FILES['file']['tmp_name'], $pathAbs)) {
        upload_json_error(500, 'move_failed');
    }
}

/* === Nachricht in messages oder group_messages speichern === */
$msgText = $isImage ? '[image]' : $originalName;

if ($type === 'user') {
    $stmt = $conn->prepare("
        INSERT INTO messages (sender_id, receiver_id, message, created_at)
        VALUES (?, ?, ?, NOW())
    ");
    $stmt->bind_param("iis", $user_id, $receiver_id, $msgText);
    $stmt->execute();
    $message_id = $stmt->insert_id;
    $stmt->close();

    $scoreStmt = $conn->prepare("
      UPDATE users
      SET gigascore = gigascore + 1
      WHERE id IN (?, ?)
    ");
    $scoreStmt->bind_param("ii", $user_id, $receiver_id);
    $scoreStmt->execute();
    $scoreStmt->close();

    $stmt2 = $conn->prepare("
        INSERT INTO message_files
            (message_id, path, is_image, original_name)
        VALUES (?, ?, ?, ?)
    ");
    $stmt2->bind_param("isis", $message_id, $pathRel, $isImage, $originalName);
    $stmt2->execute();
    $stmt2->close();
} else {
    $group_id = $receiver_id;

    $stmt = $conn->prepare("
        INSERT INTO group_messages (group_id, sender_id, message, created_at)
        VALUES (?, ?, ?, NOW())
    ");
    $stmt->bind_param("iis", $group_id, $user_id, $msgText);
    $stmt->execute();
    $message_id = $stmt->insert_id;
    $stmt->close();

    $scoreSender = $conn->prepare("UPDATE users SET gigascore = gigascore + 1 WHERE id = ?");
    $scoreSender->bind_param("i", $user_id);
    $scoreSender->execute();
    $scoreSender->close();

    $scoreMembers = $conn->prepare("
      UPDATE users u
      JOIN group_members gm ON gm.user_id = u.id
      SET u.gigascore = u.gigascore + 1
      WHERE gm.group_id = ? AND gm.user_id <> ?
    ");
    $scoreMembers->bind_param("ii", $group_id, $user_id);
    $scoreMembers->execute();
    $scoreMembers->close();

    $stmt2 = $conn->prepare("
        INSERT INTO group_message_files
            (message_id, path, is_image, original_name)
        VALUES (?, ?, ?, ?)
    ");
    $stmt2->bind_param("isis", $message_id, $pathRel, $isImage, $originalName);
    $stmt2->execute();
    $stmt2->close();
}

$conn->close();

echo json_encode(['ok' => true]);
