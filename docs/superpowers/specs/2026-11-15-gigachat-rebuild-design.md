# GigaChat 4.0 – Rebuild Design

Date: 2026-11-15
Status: approved by brief (owner authorized independent architectural decisions)

## 1. Intent

GigaChat is a small-community messenger (friends / school) that today runs as a
set of PHP pages against MySQL with 5-second polling. The owner asked for a
ground-up rebuild: a fast, reliable, scalable real-time chat delivered as a
Progressive Web App that installs and pushes notifications on iPhone/iPad,
Android and desktop, with a completely new premium UI, no technical debt, and
every existing feature preserved (GigaCoins / coin shop excluded).

## 2. Findings from the legacy analysis

- **Architecture**: ~40 PHP endpoints, each opening its own mysqli connection,
  session-cookie auth, HTML rendered server-side with a 1.7k-line `chat.js`
  that polls `sync.php` every 5 s (contacts every 15 s). No WebSockets.
- **Security debt**: DB password, VAPID private key and Giphy key committed in
  `core/config.php`; raw SQL interpolation in `index.php`, `settings.php`,
  `toggle_contact.php`, `bug_report.php`; most mutating endpoints are GET or
  lack CSRF; cookie flags inconsistent; `push-reply.php` has no auth scoping.
- **Repo state**: an unfinished merge (`login.php`, `register.php` with
  conflict markers), local `main` diverged from `origin/main`.
- **Data model (inferred, no SQL dump in repo)**: users, messages,
  message_files, chat_groups, group_members, group_messages,
  group_message_files, group_reads, user_aliases, remember_tokens,
  push_subscriptions, user_presence, site_stats_daily, site_stats_uniques,
  user_notes, bug_reports, plus r/place state in JSON files.

## 3. Feature inventory to preserve (all must work)

| Area | Features |
|------|----------|
| Auth | register (username 3–30 `[A-Za-z0-9_.-]`, password ≥ 8), login, "stay logged in" (30 d), logout, rate limiting, roles 0 user / 1 beta / 2 admin / 3 owner |
| Profile | change username, change password (requires current), name colour, emoji, delete account |
| Contacts | every user is a contact; per-contact alias, pin, archive; unread badge; sort pinned → latest message; online / last-seen; GigaScore tier emoji |
| Private chat | text, GIF (Giphy), image/file upload ≤ 20 MB with image downscale, edit, soft delete, ✔️ delivered / 👁️ read receipts, date dividers, 20-message pages with infinite scroll up, optimistic send, link detection, jump-to-bottom button |
| Groups | create with name + members, group messages (text/GIF/file), member list, add/remove (creator only), leave, per-user read cursor + unread count, "seen by" per message, group score |
| Scoring | GigaScore: +1 per sent and per received private message; +1 for every member on each group message; tier emoji (two scales: standard, beta-tester extended); own + partner score in header; live updates |
| Notes | private notes (one per user) |
| Settings | dark/light, 8 colour themes (default, purple, ocean, forest, sunset, cyber, midnight cherry, aurora; all free now), notifications on/off, links to stats, create group, release notes, bug report, roadmap (beta+), admin (admin+) |
| Statistics | online now, views today / unique today / totals, accounts, messages today / total, 30-day chart, top 10 senders, 14-day table, extended owner view |
| Admin | user list + details, revoke push, revoke sessions, reset password, change role (owner), delete account, delete any message |
| Bug reports | submit (type, title, description, priority); admin list with filters, status change, reply by DM |
| Push | VAPID web push for DM + group, suppressed while that chat is open and visible, click opens the chat, inline reply action, iOS install tutorial, daily opt-in reminder |
| r/place | 200×200 shared canvas, 60 s cooldown, leaderboard, pixel counter, realtime updates |
| Legal | Impressum, Datenschutz pages |

## 4. Goals / non-goals / anti-goals

**Goals**: sub-100 ms message delivery over WebSocket; first paint < 1 s on a
mid-range phone; installable PWA on iOS 16.4+, Android, desktop; zero secrets in
git; every mutation authenticated, validated and CSRF-safe; one command to run
locally, one `docker compose up` to run in production; tests for the core
domain.

**Non-goals**: GigaCoins and the coin shop (explicitly excluded); end-to-end
encryption; native app-store apps; multi-tenant.

**Anti-goals** (would make this a failure even if it "works"): a visual
prototype without a real backend; losing existing users' accounts and history
(a MySQL → PostgreSQL migration script is part of the deliverable); regressions
in push reliability on iOS.

## 5. Technology stack (decided)

| Layer | Choice | Why |
|-------|--------|-----|
| Language | TypeScript end-to-end (Node 24) | one language, shared types between client/server, strong tooling on the owner's machine (Node 24 + pnpm present; no PHP locally) |
| Server | Fastify 5 + `@fastify/websocket` | fastest mainstream Node HTTP framework, first-class schema validation, WebSocket on the same port |
| Realtime | native WebSocket, per-user connection registry, server-pushed events (`message.new`, `message.updated`, `read`, `presence`, `typing`, `score`, `contacts`, `place.pixel`) with a resync-on-reconnect cursor | eliminates polling, instant delivery, trivial to scale horizontally later via a pub/sub adapter |
| Database | PostgreSQL 16 in production; PGlite (embedded Postgres, WASM) for local dev and tests; Drizzle ORM + SQL migrations | real relational DB, transactions, proper indexes; dev needs no Docker; identical SQL dialect in both |
| Auth | opaque session tokens (hashed in DB) in `HttpOnly; Secure; SameSite=Lax` cookies; scrypt password hashing via `node:crypto`; legacy bcrypt `$2y$` verified with `bcryptjs` and upgraded on login; Origin + custom-header CSRF check; token-bucket rate limits | no native deps, no JWT footguns, legacy users keep their passwords |
| Push | `web-push` (VAPID from env) | standard, works with iOS PWA push |
| Uploads | `sharp` downscale to 1600 px, stored under `data/uploads`, served with immutable caching | preserves 20 MB file feature with fast images |
| Frontend | Vite 6 + React 19 + TypeScript, Zustand store, React Router 7, hand-written CSS design system (tokens, no utility framework) | small bundle, fast HMR, distinctive design not possible with templated UI kits |
| PWA | `vite-plugin-pwa` in `injectManifest` mode (custom service worker: app-shell precache, network-first navigation, push + notificationclick + inline reply) | full control over the SW is required for the push-suppression logic |
| Tests | Vitest (server integration tests on PGlite), Playwright-driven browser checks | fast, deterministic |
| Deploy | Dockerfile (multi-stage) + `docker-compose.yml` (app + postgres + volume), `.env.example`, README | reproducible on any VPS |

## 6. Architecture

```
gigachat/
  package.json            pnpm workspace (server, web, shared)
  shared/                 zod schemas + TS types for API + WS events
  server/
    src/app.ts            fastify factory (plugins, routes, ws)
    src/db/               drizzle schema, migrations, driver (pg | pglite)
    src/modules/<area>/   routes + service per area (auth, users, contacts,
                          chats, groups, uploads, push, notes, stats, admin,
                          bugs, place)
    src/realtime/         hub (userId -> sockets), event bus, presence
    src/push/             web-push sender with per-chat suppression
    scripts/migrate-mysql.ts
  web/
    src/app/              router, shell, theme provider
    src/features/<area>/  screens + components
    src/lib/              api client, ws client, store
    src/sw.ts             service worker
    src/styles/           tokens, base, components
  legacy/                 the old PHP app, kept for reference / migration
```

**Chat model**: one `conversations` table (`kind: 'dm' | 'group'`), one
`messages` table (conversation_id, sender_id, kind text/gif/image/file, body,
media fields, edited_at, deleted_at), `conversation_members` with
`last_read_message_id` (gives read receipts for DMs and "seen by" for groups
with one mechanism). DMs are found by a unique `(min(user), max(user))` key.

**Realtime flow**: HTTP POST creates the message in a transaction (insert,
bump scores, update conversation `last_message_at`) → commits → hub fans out
`message.new` to every member's open sockets → push service sends web push to
members with no socket that currently has that conversation open and visible.

**Presence**: socket open/close + a 30 s heartbeat update `users.last_seen`;
online = any open socket or `last_seen` within 90 s. Page views for the stats
page are recorded on app boot (`stats_daily`, `stats_uniques` with hashed
visitor key).

**Scoring**: `users.gigascore` maintained transactionally; the response and
the `score` WS event carry fresh values so headers update live. Group score =
total messages in the group (shown in the group header) plus each member's
share.

## 7. UI / UX direction

Premium, calm, high-contrast dark-first interface with a light mode and the 8
accent themes expressed as CSS token sets.

- Desktop ≥ 900 px: three-zone layout — compact rail (home, groups, notes,
  stats, settings), conversation list (search, pinned, archived folder),
  conversation pane with sticky header (name, status, scores), message list,
  composer.
- Mobile: stack navigation (list → conversation → details) with gesture-safe
  back button, 44 px touch targets, composer pinned above the keyboard, safe-
  area insets for the iOS home indicator and notch.
- Messages: grouped bubbles by sender/minute, date chips, inline media with
  fixed aspect ratio to avoid layout shift, long-press / right-click action
  sheet (reply-edit-delete-copy), read ticks, "seen by" avatars in groups.
- Motion: 150–250 ms ease-out transitions, respects `prefers-reduced-motion`.
- Typography: Inter via local font-display swap, tabular numbers for scores.

## 8. Security requirements

- No secrets in git; `.env` loaded at boot, startup fails loudly if missing in
  production.
- All mutations: POST/PATCH/DELETE JSON with `Origin` check and
  `X-Requested-With: fetch` header; cookies `SameSite=Lax`.
- Every route validates input with zod; authorization checks per resource
  (membership, ownership, role).
- Rate limits on login/register (10 / 15 min per IP), message send (10 / s),
  uploads (20 / min).
- Security headers (CSP allowing Giphy images, HSTS in prod, frame-ancestors
  none).
- Uploads: extension + sniffed MIME allow-list, random filenames, images re-
  encoded through sharp.

## 9. Data migration

`server/scripts/migrate-mysql.ts` reads the legacy MySQL database (connection
from env) and writes users (keeping ids, bcrypt hashes, colours, emoji, scores,
roles, themes), DMs + group chats + messages + files + read cursors, aliases /
pins / archives, notes, bug reports, push subscriptions and the r/place canvas.

## 10. Left to the builder

Exact component breakdown, icon set, copy for empty states, test case list.
The builder may add small UX improvements from the legacy roadmap when they
are cheap (Ctrl/Cmd+Enter newline, message timestamps on tap, grey compact
deleted messages).
