# GigaChat

Real-time PWA messenger. Version 4 is a full rewrite of the original PHP app.

- **Server:** Fastify, Drizzle ORM, WebSocket, Web Push (`server/`)
- **Web:** React PWA with realtime chat, groups, settings, stats, admin and r/place (`web/`)
- **Shared:** types and schemas used by both (`shared/`)
- **Legacy:** the old PHP app, kept for reference in `legacy/`

Server modules: auth, users, contacts, conversations, groups, notes, push, stats, place, bugs, admin.

## Requirements

- Node.js >= 22
- pnpm 10 (`corepack enable`)
- PostgreSQL for real deployments. Without `DATABASE_URL`, an embedded PGlite database in `DATA_DIR` is used for local development.

## Quick start

```bash
pnpm install
cp .env.example .env     # adjust values
pnpm dev                 # server + web in watch mode
```

The first user to register on an empty database becomes the owner.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run server and web in watch mode |
| `pnpm build` | Build web and server |
| `pnpm start` | Start the built server |
| `pnpm test` | Run all tests |
| `pnpm typecheck` | Type-check all packages |
| `pnpm db:generate` | Generate Drizzle migrations |
| `pnpm migrate:mysql` | Migrate data from the legacy MySQL database |

## Configuration

See [`.env.example`](.env.example). Important values:

- `DATABASE_URL`: PostgreSQL connection string (required in production)
- `PUBLIC_URL`: public origin of the app
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`: generate with `pnpm --filter @gigachat/server vapid`
- `GIPHY_API_KEY`: enables the GIF picker
- `TRUST_PROXY=1` when running behind a reverse proxy

Never commit your `.env`.

## License

[MIT](LICENSE)
