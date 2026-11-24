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
require_once __DIR__ . '/core/db.php';
try {
    $conn = get_db();
} catch (RuntimeException $e) {
    die("DB-Verbindung fehlgeschlagen.");
}
$conn->query("SET time_zone = 'Europe/Berlin'");

$message = "";
$username_value = "";

/* ===== LOGIN VERARBEITEN ===== */
if ($_SERVER["REQUEST_METHOD"] === "POST") {
    $username = trim($_POST['username'] ?? '');
    $password = $_POST['password'] ?? '';
    $username_value = htmlspecialchars($username, ENT_QUOTES, 'UTF-8');

    if ($username === '' || $password === '') {
        $message = "Bitte Benutzername und Passwort eingeben.";
    } else {
        $stmt = $conn->prepare("SELECT id, username, password, role FROM users WHERE username = ?");
        $stmt->bind_param("s", $username);
        $stmt->execute();
        $res = $stmt->get_result();
        $user = $res->fetch_assoc();
        $stmt->close();

        if ($user && password_verify($password, $user['password'])) {
            // Session-Regeneration gegen Session-Fixation
            session_regenerate_id(true);

            $_SESSION['user_id'] = (int)$user['id'];
            $_SESSION['username'] = $user['username'];
            $_SESSION['role'] = (int)$user['role'];

            // Remember Me (30 Tage)
            if (isset($_POST['remember'])) {
                $selector = bin2hex(random_bytes(9));
                $token = random_bytes(32);
                $hashedToken = password_hash($token, PASSWORD_DEFAULT);
                $expires = date('Y-m-d H:i:s', time() + 30 * 24 * 60 * 60);

                $stmt = $conn->prepare("
                    INSERT INTO remember_tokens (selector, hashed_token, user_id, expires_at)
                    VALUES (?, ?, ?, ?)
                ");
                $stmt->bind_param("ssis", $selector, $hashedToken, $user['id'], $expires);
                $stmt->execute();
                $stmt->close();

                setcookie('remember', $selector . ':' . base64_encode($token), [
                    'expires' => time() + 30 * 24 * 60 * 60,
                    'path' => '/',
                    'secure' => true,
                    'httponly' => true,
                    'samesite' => 'Lax'
                ]);
            }

            header("Location: index.php");
            exit;
        } else {
            $message = "Falscher Benutzername oder falsches Passwort.";
        }
    }
}
?>
<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Login - GigaChat</title>
<link rel="icon" type="image/png" href="assets/img/logo-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    min-height: 100dvh;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    background: #09090b;
    color: #fafafa;
    -webkit-font-smoothing: antialiased;
    display: flex;
    align-items: center;
    justify-content: center;
    background-image:
      radial-gradient(ellipse 70% 50% at 20% 0%, rgba(99,102,241,0.12) 0%, transparent 60%),
      radial-gradient(ellipse 50% 40% at 80% 100%, rgba(167,139,250,0.08) 0%, transparent 50%);
  }
  .login-card {
    background: rgba(18,18,24,0.9);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 20px;
    padding: 36px 32px;
    width: 100%;
    max-width: 380px;
    backdrop-filter: blur(20px);
    box-shadow: 0 24px 60px rgba(0,0,0,0.6);
    margin: 16px;
  }
  .login-logo { text-align: center; margin-bottom: 28px; }
  .login-logo h1 {
    margin: 0;
    font-size: 1.75rem;
    font-weight: 700;
    background: linear-gradient(135deg, #6366f1, #a78bfa);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    letter-spacing: -0.02em;
  }
  .login-logo p { margin: 6px 0 0; font-size: 0.875rem; color: #71717a; }
  .form-group { margin-bottom: 14px; }
  .form-label {
    display: block;
    font-size: 0.75rem;
    font-weight: 600;
    color: #a1a1aa;
    margin-bottom: 6px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  input[type="text"], input[type="password"] {
    width: 100%;
    padding: 11px 14px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    color: #fafafa;
    font-size: 0.95rem;
    font-family: inherit;
    outline: none;
    transition: border-color 0.18s ease, box-shadow 0.18s ease;
  }
  input[type="text"]::placeholder, input[type="password"]::placeholder { color: #52525b; }
  input[type="text"]:focus, input[type="password"]:focus {
    border-color: #6366f1;
    box-shadow: 0 0 0 3px rgba(99,102,241,0.2);
    background: rgba(255,255,255,0.07);
  }
  .remember-row { display: flex; align-items: center; gap: 8px; margin-bottom: 20px; cursor: pointer; }
  .remember-row input[type="checkbox"] { width: 16px; height: 16px; accent-color: #6366f1; cursor: pointer; flex-shrink: 0; }
  .remember-row span { font-size: 0.875rem; color: #a1a1aa; }
  .error-msg {
    background: rgba(239,68,68,0.12);
    border: 1px solid rgba(239,68,68,0.25);
    border-radius: 8px;
    color: #fca5a5;
    padding: 10px 14px;
    font-size: 0.85rem;
    margin-bottom: 14px;
  }
  .btn-primary {
    width: 100%;
    padding: 12px;
    background: #6366f1;
    color: #fff;
    border: none;
    border-radius: 10px;
    font-size: 0.95rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: opacity 0.15s ease, transform 0.12s ease;
    margin-bottom: 10px;
  }
  .btn-primary:hover { opacity: 0.9; }
  .btn-primary:active { transform: scale(0.98); }
  .btn-secondary {
    display: block;
    width: 100%;
    padding: 12px;
    background: transparent;
    color: #a1a1aa;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    font-size: 0.875rem;
    font-weight: 500;
    font-family: inherit;
    text-align: center;
    text-decoration: none;
    transition: background 0.15s ease, color 0.15s ease;
  }
  .btn-secondary:hover { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.18); color: #fafafa; }
  @media (max-width: 440px) {
    .login-card { padding: 28px 20px; border-radius: 16px; margin: 12px; }
  }
</style>
</head>
<body>
<div class="login-card">
  <div class="login-logo">
    <h1>GigaChat</h1>
    <p>Meld dich an, um weiterzumachen</p>
  </div>
  <form method="post" autocomplete="off">
    <?php if ($message): ?>
      <div class="error-msg"><?= htmlspecialchars($message) ?></div>
    <?php endif; ?>
    <div class="form-group">
      <label class="form-label" for="username">Benutzername</label>
      <input type="text" id="username" name="username" placeholder="Dein Benutzername" value="<?= $username_value ?>" required autofocus>
    </div>
    <div class="form-group">
      <label class="form-label" for="password">Passwort</label>
      <input type="password" id="password" name="password" placeholder="Dein Passwort" required>
    </div>
    <label class="remember-row">
      <input type="checkbox" name="remember" value="1">
      <span>Angemeldet bleiben</span>
    </label>
    <button type="submit" class="btn-primary">Einloggen</button>
    <a class="btn-secondary" href="register.php">Noch kein Konto? Registrieren</a>
  </form>
</div>
</body>
</html>