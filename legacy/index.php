<?php
session_start();

/* ===== DEBUG ===== */
$debug = (isset($_SESSION['user_id']) && (int)$_SESSION['user_id'] === 1 && isset($_GET['debug']));
error_reporting(E_ALL);
ini_set('display_errors', $debug ? '1' : '0');
ini_set('log_errors', '1');
ini_set('error_log', __DIR__ . '/php-error.log');

/* ===== PHP TIMEZONE ===== */
date_default_timezone_set('Europe/Berlin');

/* ===== DB VERBINDUNG ===== */
require_once __DIR__ . '/core/config.php';
$conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
if ($conn->connect_error) {
    die("DB-Verbindung fehlgeschlagen: " . $conn->connect_error);
}
$conn->set_charset('utf8mb4');
$conn->query("SET time_zone = 'Europe/Berlin'");

/* ===== REMEMBER-ME LOGIN ===== */
if (!isset($_SESSION['user_id']) && isset($_COOKIE['remember'])) {
    list($selector, $token) = explode(':', $_COOKIE['remember'], 2);

    if ($selector && $token) {
        $token = base64_decode($token);

        if (strlen($token) === 32) {
            $stmt = $conn->prepare("
                SELECT user_id, hashed_token 
                FROM remember_tokens 
                WHERE selector = ? AND expires_at > NOW()
            ");
            $stmt->bind_param("s", $selector);
            $stmt->execute();
            $res = $stmt->get_result();

            if ($row = $res->fetch_assoc()) {
                if (password_verify($token, $row['hashed_token'])) {
                    session_regenerate_id(true);
                    $_SESSION['user_id'] = (int)$row['user_id'];

                    $u = $conn->prepare("SELECT username, gigacoin FROM users WHERE id = ?");
                    $u->bind_param("i", $_SESSION['user_id']);
                    $u->execute();
                    $userRow = $u->get_result()->fetch_assoc();
                    $_SESSION['username'] = $userRow['username'] ?? null;
                    $_SESSION['gigacoin'] = (int)($userRow['gigacoin'] ?? 0);
                    $u->close();
                }
            }
            $stmt->close();
        }
    }
}

/* ===== LOGIN CHECK ===== */
if (!isset($_SESSION['user_id'], $_SESSION['username'])) {
    header("Location: login.php");
    exit;
}

$user_id = (int)$_SESSION['user_id'];

/* ===== ROLLE LADEN ===== */
$stmt = $conn->prepare("SELECT role FROM users WHERE id = ?");
$stmt->bind_param("i", $user_id);
$stmt->execute();
$stmt->bind_result($myRole);
$stmt->fetch();
$stmt->close();

$_SESSION['role'] = (int)$myRole;

/* ===== STATS ===== */
require_once __DIR__ . '/core/config_stats.php';
require_once __DIR__ . '/core/stats_bootstrap.php';

if (
    isset($_SESSION['user_id']) &&
    function_exists('record_presence_and_stats')
) {
    record_presence_and_stats(
        $conn,
        (int)$_SESSION['user_id'],
        basename($_SERVER['PHP_SELF'])
    );
}

/* ===== LAST SEEN UPDATE ===== */
$conn->query("UPDATE users SET last_seen = NOW() WHERE id = $user_id");

/* ===== EIGENER GIGASCORE + THEME ===== */
$stmt = $conn->prepare("SELECT gigascore, active_theme FROM users WHERE id = ?");
$stmt->bind_param("i", $user_id);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();

$myScore = (int)($row['gigascore'] ?? 0);
$_SESSION['active_theme'] = $row['active_theme'] ?? 'default';

$stmt->close();

/* ===== AKTUELLEN CHAT ===== */
$current_chat = isset($_GET['user_id']) ? (int)$_GET['user_id'] : 0;
$current_type = 'user';

if (
    $current_chat === 0 &&
    isset($_COOKIE['last_chat_user']) &&
    !isset($_GET['from_push'])
) {
    $lc = (int)$_COOKIE['last_chat_user'];
    if ($lc > 0 && $lc !== $user_id) {
        $current_chat = $lc;
        // Gespeicherten TYP mit übernehmen (group/user), damit die zuletzt
        // offene Gruppe nach einem Reload wieder korrekt geöffnet wird.
        if (isset($_COOKIE['last_chat_type']) && $_COOKIE['last_chat_type'] === 'group') {
            $current_type = 'group';
        }
    }
}

/* ===== USER & GRUPPEN ===== */

$groups = $conn->query("
    SELECT g.id, g.name
    FROM chat_groups g
    JOIN group_members gm ON g.id = gm.group_id
    WHERE gm.user_id = $user_id
    ORDER BY g.id ASC
");

// Markiere ungelesene Nachrichten als gelesen (nur Privatchats!)
if($current_chat > 0 && $current_type === 'user'){
    $conn->query("UPDATE messages 
                  SET read_at = NOW() 
                  WHERE sender_id = $current_chat 
                    AND receiver_id = $user_id
                    AND read_at IS NULL");
}

// Kontakte laden
$contacts = $conn->query("
    SELECT u.id, u.username, ua.alias, u.color, u.emoji
    FROM users u
    LEFT JOIN user_aliases ua 
        ON ua.owner_id = $user_id AND ua.target_id = u.id
    WHERE u.id != $user_id
");
if(!$contacts){
    die("Fehler beim Laden der Kontakte: " . $conn->error);
}


// Aktuellen Chat-Partner bzw. Gruppennamen laden
$currentUser = null;
if ($current_chat > 0) {
    if ($current_type === 'group') {
        $stmtCU = $conn->prepare("SELECT name AS username FROM chat_groups WHERE id = ?");
    } else {
        $stmtCU = $conn->prepare("SELECT username FROM users WHERE id = ?");
    }
    $stmtCU->bind_param("i", $current_chat);
    $stmtCU->execute();
    $resCU = $stmtCU->get_result();
    $currentUser = $resCU->fetch_assoc();
    $stmtCU->close();
}

/* ===== THEME AKTIVIEREN (aus den Einstellungen) ===== */
if (isset($_POST['activate_theme'])) {

    $theme = $_POST['activate_theme'];

    $allowed = [
        'default',
        'purple',
        'ocean',
        'forest',
        'sunset',
        'cyber',
        'midnight_cherry',
        'aurora_borealis'
    ];

    if (in_array($theme, $allowed)) {

        $stmt = $conn->prepare("UPDATE users SET active_theme = ? WHERE id = ?");
        $stmt->bind_param("si", $theme, $user_id);
        $stmt->execute();
        $stmt->close();

        $_SESSION['active_theme'] = $theme;

        header("Location: index.php");
        exit;
    }
}
?>
<!--HTML -->
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="description" content="GigaChat – schneller, moderner Messenger">
    <link rel="icon" type="image/png" href="assets/img/logo-192.png">
    <link rel="apple-touch-icon" href="assets/img/logo-180.png">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <title>Gigachat</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="assets/css/style.css?v=3.1">

    <!-- PWA -->
    <link rel="manifest" href="/manifest.json">
    <meta name="theme-color" content="#111111">
    <script src="assets/js/pwa.js?v=3.1"></script>
</head>
<body class="theme-<?php echo htmlspecialchars($_SESSION['active_theme'] ?? 'default'); ?>">

  <!-- Install-Button (PWA Desktop/iOS) — wird per pwa.js angezeigt, wenn beforeinstallprompt feuert -->
  <button id="install-app-btn" onclick="installGigaApp()"
          style="display:none; position:fixed; right:16px; bottom:16px; z-index:2000;
                 background:#6b6bff; color:#fff; border:0; border-radius:50px; padding:10px 16px;
                 font-size:14px; cursor:pointer; opacity:.9; box-shadow:0 4px 14px rgba(0,0,0,.3);">
    📱 App installieren
  </button>

  <!-- iOS-Install-Tutorial (Apple unterstützt kein beforeinstallprompt) -->
  <div id="ios-install-banner"
       style="display:none; position:fixed; inset:0; background:rgba(0,0,0,.7); z-index:2100;
              align-items:center; justify-content:center; text-align:center; color:#fff; padding:24px;">
    <div style="background:#111; border-radius:16px; padding:24px; max-width:420px;">
      <h3 style="margin:0 0 12px; font-size:20px;">📱 Als App installieren</h3>
      <p style="margin:0 0 16px; line-height:1.5;">
        Teile diese Seite ➜ tippe auf <strong>„Zur Home-Bildschirm‑Startseite“</strong>
        ➜ „Fertig“. GigaChat startet dann ohne Browser-Leiste – wie eine echte App.
      </p>
      <button onclick="this.closest('#ios-install-banner').style.display='none'"
              style="background:#6b6bff; color:#fff; border:0; padding:10px 20px;
                     border-radius:10px; cursor:pointer;">✕ Verstanden</button>
    </div>
  </div>

  <!-- R/place Button -->
  <a href="/place/place.php" class="floating-button">
    🖼️
</a>

  <!-- benachichtigung reminder -->
<div id="push-modal" class="push-modal" style="display:none;">
  <div class="push-card">
    <h3>🔔 Benachrichtigungen aktivieren</h3>
    <p id="push-text"></p>

    <div class="push-actions">
      <button id="push-action">Aktivieren</button>
      <button id="push-close" class="ghost">Später</button>
    </div>
  </div>
</div>


<!--
<footer class="tob-bar">
        <button class="top-left" onclick="window.location.href='create_group.php'">🆕 Gruppe</button>
        <button class="top-left" onclick="window.location.href='settings.php'">⚙️ Einstellungen</button>
    <strong> GigaChat 2.7</strong>
    <a href="release-notes-2.7.html" target="_blank">
        <span style="text-decoration:underline;">Release-Notes 2.7</span>
    </a>
    | <a href="impressum.html">Impressum</a>
    | <a href="datenschutz.html">Datenschutz</a>
    | Für Vorschläge oder Bugs: <strong>HenRun189</strong>
</footer>
-->
</div>




<div class="container">
    <!-- Chatbereich -->
    <div class="chat-card">
        <h2 id="chatWith" class="chat-header clickable-group">
          <span class="chat-left">
            <span id="chatWithName">
              <?php echo htmlspecialchars($currentUser['username'] ?? 'Chat'); ?>
            </span>
            <span class="arrow">▾</span>
            <span id="userStatus"></span>
          </span>

          <span class="chat-center">
            <span class="score-number" id="theirGigaScore">–</span>
            <span class="score-label">GigaScore</span>
          </span>

          <span class="chat-right">
            <span class="score-number"><?php echo (int)$myScore; ?></span>
            <span class="score-label">Mein Score</span>
          </span>
        </h2>

        <!-- Menü für Gruppen oder Personen -->
        <div id="chatMenu" class="chat-menu" style="display:none;">
            <h3 id="menuTitle"></h3>
            <ul id="menuMembers"></ul>
            <button id="menuActionBtn" style="display:none;"></button>
        </div>

        <button id="loadOlderBtn" class="load-older-btn" type="button" style="display:none;">↑ Ältere Nachrichten laden</button>
        <div id="chatbox"></div>
        <button id="scrollBottomBtn" class="scroll-bottom-btn" type="button" aria-label="Zur neuesten Nachricht springen">↓</button>

        <form id="chatForm" class="chat-input">
            <input type="hidden" name="receiver_id" id="receiver_id" value="<?php echo $current_chat; ?>">
            <input type="file" id="imageInput" accept="image/*" style="display:none">
            <button type="button" id="gifBtn" title="GIF senden">GIF</button>
            <button type="button" id="addImageBtn" title="Bild senden">📎</button>
            <input type="text" name="message" id="message" placeholder="Nachricht schreiben…" autocomplete="off">
            <div id="gifResults" style="display:none"></div>
            <button type="submit">Senden</button>
        </form>
    </div>

        <!-- Benutzerliste rechts -->
        <div class="users-card">
            <?php
            $users = $conn->query("
                SELECT u.id, u.username, ua.alias, u.color, u.emoji 
                FROM users u
                LEFT JOIN user_aliases ua 
                    ON ua.owner_id = $user_id AND ua.target_id = u.id
                WHERE u.id != $user_id
                ORDER BY u.id ASC
            ");
            ?>
            <ul class="users-list">
                <?php while($row = $users->fetch_assoc()): ?>
                    <li data-id="<?= $row['id'] ?>" data-type="user">
                        <div class="user-btn" style="color: <?= htmlspecialchars($row['color']) ?>">
                            <?= htmlspecialchars(($row['emoji'] ? $row['emoji'] . ' ' : '') . ($row['alias'] ?: $row['username'])) ?>
                        </div>
                    </li>
                <?php endwhile; ?>
                
                <?php while($row = $groups->fetch_assoc()): ?>
                    <li data-id="<?= $row['id'] ?>" data-type="group">
                        <div class="user-btn">
                            <?= htmlspecialchars($row['name']) ?>
                        </div>
                    </li>
                <?php endwhile; ?>
                
                <li style="list-style: none;">
                    <div class="user-btn" onclick="window.open('menu/')" style="background:#6b6bff; color:#fff; cursor:pointer; text-align:center;">
                        📱 Menü andere Webseiten
                    </div>
                </li>
                <li style="list-style: none;">
                    <div class="user-btn" style="background:#ff6b6b; color:#fff; cursor:pointer; text-align:center;" onclick="window.location.href='logout.php'">
                        🔒 Logout
                    </div>
                </li>
            </ul>
        </div>
</div>

<!--
<footer class="footer-bottom">
    Alle Rechte beim Owner <strong>Henri Himmelmann</strong>.
</footer>
-->

<div id="imageOverlay" class="image-overlay" style="display:none;">
  <div class="image-overlay-inner">
    <img id="overlayImg" src="" alt="">
    <div class="image-overlay-actions">
      <button id="overlayClose">Schließen</button>
      <button id="overlayOpenTab">In neuem Tab (nicht in App drücken)</button>
      <button id="overlayDownload">Speichern (nicht in App drücken)</button>
    </div>
  </div>
</div>
<div id="notesOverlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:999;">
  <div style="background:#111;color:#fff;max-width:600px;margin:10vh auto;padding:15px;border-radius:12px;">
    <h3>📝 Private Notizen</h3>
    <textarea id="notesText" style="width:100%;height:300px;"></textarea>
    <div style="margin-top:10px;text-align:right;">
      <button onclick="saveNotes()">💾 Speichern</button>
      <button onclick="closeNotes()">Schließen</button>
    </div>
  </div>
</div>

<!-- GIF Overlay (Mobile-friendly) -->
<div id="gifOverlay" class="gif-overlay" style="display:none;">
  <div class="gif-panel">
    <div class="gif-header">
      <input id="gifSearchOverlay" placeholder="GIF suchen…" />
      <button id="gifClose">✕</button>
    </div>

    <div id="gifResultsOverlay" class="gif-results"></div>
  </div>
</div>


</body>
</html>

<!-- Konfetti-Bibliothek -->
<script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js"></script>

<script>
window.GIGA = {
  chatId: <?= (int)$current_chat ?>,
  chatType: <?= json_encode($current_type) ?>,
  userId: <?= (int)$user_id ?>,
  sessionUserId: <?= (int)$_SESSION['user_id'] ?>,
  sessionRole: <?= (int)($_SESSION['role'] ?? 0) ?>
};
</script>
<script src="assets/js/chat.js?v=3.1"></script>