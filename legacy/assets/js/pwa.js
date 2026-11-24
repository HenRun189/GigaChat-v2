/* GigaChat PWA: ServiceWorker-Registration, Install-Prompt (App-Icon) & iOS-Tutorial
 * - Registriert den SW (einmalig, cached)
 * - beforeinstallprompt abfangen -> Install-Button für iPad/Desktop ("Zur Home-Bildschirm"-App)
 * - iOS: Eigenes Tutorial, weil Apple beforeinstallprompt nicht unterstuetzt
 * Arbeitet mit chat.js zusammen: chat.js sendet nach SW-Ready den Chat-State.
 */
(function () {
    'use strict';

    // 1) Service Worker registrieren
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js?v=3.1')
            .then(reg => console.log('[PWA] ServiceWorker registriert', reg.scope))
            .catch(err => console.error('[PWA] ServiceWorker-Registrierung fehlgeschlagen:', err));
    }

    // 2) Install-Prompt abfangen (Android / Windows / macOS Chrome)
    let deferredPrompt = null;
    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        deferredPrompt = e;
        const btn = document.getElementById('install-app-btn');
        if (btn) btn.style.display = 'inline-flex';
    });

    // 3) Install-Button anklicken -> Prompt auslösen
    window.installGigaApp = function () {
        if (!deferredPrompt) return;
        const btn = document.getElementById('install-app-btn');
        if (btn) btn.style.display = 'none';
        deferredPrompt.prompt();
                deferredPrompt.userChoice.then(() => { deferredPrompt = null; });
    };

    // 4) Nach Installation: App-Toast + sofort Sync (App-Start == online)
    window.addEventListener('appinstalled', () => {
        console.log('[PWA] GigaChat als App installiert');
        if (typeof window.showGigaToast === 'function') {
            window.showGigaToast('GigaChat wurde installiert! 🎉');
        }
        if (typeof window.pollNewMessages === 'function' && !document.hidden) {
            window.pollNewMessages(true);
        }
    });

    // 5) iOS: Eigenes "Zur Home-Bildschirm"-Tutorial (Apple hat kein beforeinstallprompt)
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isStandalone = () =>
        window.matchMedia('(display-mode: standalone)').matches ||
        navigator.standalone === true;

    if (isIOS && !isStandalone()) {
        const banner = document.getElementById('ios-install-banner');
        if (banner) banner.style.display = 'flex';
    }
})();

