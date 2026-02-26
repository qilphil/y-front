# y-front

A multi-user web frontend for [yt-dlp](https://github.com/yt-dlp/yt-dlp) as a remote download engine.

Queue URLs for download, monitor progress in real time, manage the queue with drag-and-drop reordering, browse and download completed files, and configure global settings through an admin UI — all from a browser.

## Features

- **Dashboard** — quick-add form, live queue mini-list, recent downloads panel; all update via SSE
- **Multi-user** — admin and user roles, per-user job ownership
- **Real-time progress** — live speed, ETA, and percentage via Server-Sent Events
- **Format picker** — analyse available formats per URL before queuing, or use global defaults; handles muxed-only streams (ARD, 3sat, ZDF) and deduplicates CDN variants
- **Playlist support** — expand YouTube playlists and select individual entries
- **Queue management** — drag-and-drop reorder, cancel, pause/resume, retry failed jobs
- **File manager** — browse, sort, and download completed files; streaming binary download without loading files into memory; directory navigation with breadcrumbs
- **Admin settings** — global format defaults, output path, max concurrent downloads
- **Audit log** — all significant actions are logged per user
- **No CDN** — Bootstrap and SortableJS served from local dependencies

## Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js ≥ 18 |
| Framework | Express 5 |
| Templates | Pug |
| CSS | Bootstrap 5 |
| Database | SQLite (`better-sqlite3`) |
| Sessions | SQLite-backed `express-session` |
| Auth | bcrypt |
| Progress | Server-Sent Events |
| Drag-and-drop | SortableJS |
| Process manager | PM2 |

## Requirements

- Node.js ≥ 18
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) installed and on `$PATH` (or configure `YTDLP_PATH`)
- ffmpeg (recommended, required for format merging)
- Yarn

## Setup

```bash
git clone https://github.com/qilphil/y-front.git
cd y-front
yarn install
cp .env.example .env
# edit .env — set SESSION_SECRET, PORT, DB_PATH, YTDLP_PATH
node src/server.js
```

On first run the server prints a one-time admin username and password to stdout. Log in and change the password immediately.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3420` | HTTP port |
| `DB_PATH` | `./db/y-front.db` | SQLite database path |
| `SESSION_SECRET` | *(required)* | Secret for session signing |
| `NODE_ENV` | `development` | Set to `production` in prod |
| `YTDLP_PATH` | `yt-dlp` | Path to yt-dlp binary |

## Running with PM2

```bash
# copy and edit the env file first
cp .env.example .env

pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # to survive reboots
```

## Default format

```
bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best
```

Configurable globally in Settings (admin only) or overridden per job.

## License

MIT
