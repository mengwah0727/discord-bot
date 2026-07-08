# Discord Bot

Discord.js bot for server announcements, scheduled messages, giveaways, team recruitment, and join-to-create voice channels.

## Features

- `/send` sends an announcement to a selected text channel.
- `/schedule` sends a one-time delayed message.
- `/schedule-weekly` creates recurring weekly announcements in GMT+8.
- `/schedule-list` and `/schedule-delete` manage weekly announcements.
- `/giveaway-start`, `/giveaway-end`, `/giveaway-reroll`, and `/giveaway-participants` manage button-based giveaways.
- `/wwm-create`, `/valorant-create`, and `/team-list` manage role-based team recruitment posts with waitlists, start times, and reminders.
- `/tempvoice-set` and `/tempvoice-disable` manage join-to-create temporary voice rooms.
- `/play` accepts a song name, YouTube link, Spotify track, or Spotify playlist.
- `/music` opens the current music control panel.

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
YOUTUBE_DL_SKIP_PYTHON_CHECK=1
```

For persistent schedules, giveaways, team posts, and temporary voice tracking, attach a Railway volume and mount it at `/data`. Without a volume, Railway restarts can reset `db.json`.

## Music

Join a voice channel and use `/play`. Everyone in the same voice channel can control previous, pause, skip, stop, shuffle, loop, queue, and volume from the panel. Spotify playlists are limited to 50 tracks, and music queues are cleared whenever the bot restarts.

Spotify links provide song information and are matched to a playable YouTube source. YouTube extraction is unofficial and can occasionally be blocked on hosting-provider IPs. If Railway is challenged, set `YOUTUBE_COOKIE` to a valid cookie header and treat it as a secret. Never commit that value.

Music playback uses more CPU and network traffic than the bot's text features. FFmpeg is bundled through `ffmpeg-static`; `YOUTUBE_DL_SKIP_PYTHON_CHECK=1` lets Railway install the YouTube helper without requiring a separate Python runtime check.

## Team Posts

`/wwm-create` and `/valorant-create` support an optional `start_time`:

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
