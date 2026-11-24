<?php
/**
 * GigaChat - VAPID Key Generator
 * 
 * SECURITY: This file requires admin authentication and does NOT expose phpinfo().
 * VAPID keys are generated once and then hardcoded in the push notification files.
 * After generating keys, this file should be deleted from the server.
 */

session_start();

// Only allow Owner (user_id = 1) to access this file
if (!isset($_SESSION['user_id']) || (int)$_SESSION['user_id'] !== 1) {
    http_response_code(403);
    die('Forbidden - only the owner can access this page');
}

require __DIR__ . '/../../vendor/autoload.php';

use Minishlink\WebPush\VAPID;

if (!class_exists('Minishlink\\WebPush\\VAPID')) {
    http_response_code(500);
    die('WebPush-Bibliothek (vendor/) ist auf diesem Server nicht installiert.');
}

$keys = VAPID::createVapidKeys();

?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <title>VAPID Keys</title>
    <style>
        body { font-family: monospace; padding: 20px; background: #1a1a1a; color: #fff; }
        .key { background: #2a2a2a; padding: 12px; border-radius: 8px; margin: 10px 0; word-break: break-all; }
        .warning { background: #4a2020; padding: 12px; border-radius: 8px; margin: 20px 0; }
    </style>
</head>
<body>
    <h1>VAPID Keys</h1>
    
    <div class="warning">
        ⚠️ <strong>WARNUNG:</strong> Kopiere diese Keys in deine Push-Notification-Dateien 
        (send_message.php, send_group_message.php, settings.php, etc.) und 
        <strong>lösche diese Datei danach vom Server!</strong>
    </div>
    
    <h2>Public Key:</h2>
    <div class="key"><?php echo htmlspecialchars($keys['publicKey']); ?></div>
    
    <h2>Private Key:</h2>
    <div class="key"><?php echo htmlspecialchars($keys['privateKey']); ?></div>
</body>
</html>