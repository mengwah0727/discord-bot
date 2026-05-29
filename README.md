# Discord Bot

Discord.js bot for server announcements, scheduled messages, giveaways, team recruitment, and join-to-create voice channels.

## Features

- `/send` sends an announcement to a selected text channel.
- `/schedule` sends a one-time delayed message.
- `/schedule-weekly` creates recurring weekly announcements in GMT+8.
- `/schedule-list` and `/schedule-delete` manage weekly announcements.
- `/giveaway-start`, `/giveaway-end`, `/giveaway-reroll`, and `/giveaway-participants` manage button-based giveaways.
- `/team-create` and `/team-list` manage role-based team recruitment posts.
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

## Local setup

```bash
npm install
cp .env.example .env
npm run deploy-commands
npm start
```

Do not commit `.env` or `data/db.json`; they contain environment-specific runtime data.
