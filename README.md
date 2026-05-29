# Discord Bot

Discord.js bot for server announcements, scheduled messages, giveaways, team recruitment, and join-to-create voice channels.

## Features

- `/send` sends an announcement to a selected text channel.
- `/schedule` sends a one-time delayed message.
- `/schedule-weekly` creates recurring weekly announcements in GMT+8.
- `/schedule-list` and `/schedule-delete` manage weekly announcements.
- `/giveaway-start`, `/giveaway-end`, `/giveaway-reroll`, and `/giveaway-participants` manage button-based giveaways.
- `/team-create` and `/team-list` manage role-based team recruitment posts with waitlists, start times, and reminders.
- `/tempvoice-set` and `/tempvoice-disable` manage join-to-create temporary voice rooms.

## Railway

Railway runs the bot with:

```bash
npm start
```

Set these Railway variables:

```bash
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DATA_DIR=/data
```

For persistent schedules, giveaways, team posts, and temporary voice tracking, attach a Railway volume and mount it at `/data`. Without a volume, Railway restarts can reset `db.json`.

## Team Posts

`/team-create` supports an optional `start_time`:

```text
21:30
05-29 21:30
2026-05-29 21:30
```

Times are treated as GMT+8. If the team post has a start time, the bot automatically reminds joined players and waitlisted players 30 minutes before the start. The creator or a server manager can also use the reminder button on the team post.

## Local setup

```bash
npm install
cp .env.example .env
npm run deploy-commands
npm start
```

Do not commit `.env` or `data/db.json`; they contain environment-specific runtime data.
