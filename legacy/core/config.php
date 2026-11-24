<?php
/**
 * GigaChat – zentrale Konfiguration
 *
 * Bitte KEINE Zugangsdaten hart codieren, sondern per Umgebungsvariablen
 * setzen (z. B. in der Apache-Nginx-Konfiguration oder .env). Die Werte
 * unten sind nur Fallbacks für die lokale Entwicklung.
 */
declare(strict_types=1);

date_default_timezone_set('Europe/Berlin');

/* ===== Datenbank ===== */
define('DB_HOST', getenv('DB_HOST') ?: 'localhost');
define('DB_USER', getenv('DB_USER') ?: 'webapp_user');
define('DB_PASS', getenv('DB_PASS') ?: '');
define('DB_NAME', getenv('DB_NAME') ?: 'chat');

/* ===== Web-Push (VAPID) ===== */
define('VAPID_SUBJECT',  getenv('VAPID_SUBJECT') ?: 'mailto:henri@linhi.de');
define('VAPID_PUBLIC',   getenv('VAPID_PUBLIC_KEY') ?: 'BGKaUZpoIpfq4mOBjwj4SnTol4lTpimNI113onzGdUMNMGt0VMiz9sJdYdXwhEeQ_3Z_Jiz7XTZwelw617tcpI8');
define('VAPID_PRIVATE',  getenv('VAPID_PRIVATE_KEY') ?: '');

/* ===== Giphy (nur Client-Side, trotzdem zentral) ===== */
define('GIPHY_API_KEY', getenv('GIPHY_API_KEY') ?: '');