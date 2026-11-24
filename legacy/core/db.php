<?php
/**
 * GigaChat - Shared Database Configuration
 *
 * Centralized MySQL database connection using mysqli.
 * All PHP files should require_once this file for consistent DB access.
 *
 * Usage:
 *   require_once __DIR__ . '/db.php';
 *   $conn = get_db();
 */

declare(strict_types=1);

/**
 * Returns a singleton mysqli database connection.
 *
 * @return mysqli
 * @throws RuntimeException If the database connection fails.
 */
function get_db(): mysqli
{
    static $conn = null;

    if ($conn === null) {
        require_once __DIR__ . '/config.php';

        $host = DB_HOST;
        $user = DB_USER;
        $pass = DB_PASS;
        $name = DB_NAME;

        // Suppress warning to use our own error handling
        $conn = @new mysqli($host, $user, $pass, $name);

        if ($conn->connect_error) {
            error_log('Database connection failed: ' . $conn->connect_error);
            throw new RuntimeException('Database connection failed', 0);
        }

        $conn->query("SET time_zone = 'Europe/Berlin'");
        $conn->set_charset('utf8mb4');
    }

    return $conn;
}

/**
 * Returns the currently authenticated user ID from the session.
 * Returns null if not authenticated.
 *
 * @return int|null
 */
function get_current_user_id(): ?int
{
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }

    if (!isset($_SESSION['user_id'])) {
        return null;
    }

    return (int) $_SESSION['user_id'];
}

/**
 * Requires the user to be authenticated. Sends 401 JSON error and exits if not.
 *
 * @return int The authenticated user ID.
 */
function require_auth(): int
{
    $userId = get_current_user_id();

    if ($userId === null) {
        http_response_code(401);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Nicht autorisiert']);
        exit;
    }

    return $userId;
}

/**
 * Sends a JSON response and exits.
 *
 * @param mixed $data Data to encode as JSON.
 * @param int $statusCode HTTP status code.
 */
function json_response($data, int $statusCode = 200): void
{
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * Escapes HTML for safe output (XSS prevention).
 *
 * @param string|null $value The value to escape.
 * @return string The escaped string.
 */
function e(?string $value): string
{
    return htmlspecialchars($value ?? '', ENT_QUOTES | ENT_HTML5, 'UTF-8');
}

/**
 * Sanitizes a string by trimming and limiting its length.
 *
 * @param string|null $value The value to sanitize.
 * @param int $maxLength Maximum allowed length.
 * @return string The sanitized string.
 */
function sanitize_string(?string $value, int $maxLength = 255): string
{
    $value = trim((string) $value);
    if (mb_strlen($value) > $maxLength) {
        $value = mb_substr($value, 0, $maxLength);
    }
    return $value;
}

/**
 * Generates a CSRF token and stores it in the session.
 *
 * @return string The CSRF token.
 */
function get_csrf_token(): string
{
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }

    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }

    return $_SESSION['csrf'];
}

/**
 * Validates a CSRF token from the request.
 *
 * @return bool True if valid, false otherwise.
 */
function validate_csrf(): bool
{
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }

    $token = $_POST['csrf'] ?? '';

    return !empty($_SESSION['csrf'])
        && hash_equals($_SESSION['csrf'], (string) $token);
}

/**
 * Requires a valid CSRF token. Sends 403 and exits if invalid.
 */
function require_csrf(): void
{
    if (!validate_csrf()) {
        json_response(['error' => 'CSRF-Token ungültig'], 403);
    }
}