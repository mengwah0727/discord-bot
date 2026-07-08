# Music Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/play` and `/music` with a polished two-row control panel for song-name, YouTube, and Spotify playback in the existing Discord bot.

**Architecture:** Keep Discord Player behind a focused `music/player.js` adapter and keep deterministic policy and presentation behavior in independently tested modules. `index.js` initializes the adapter and delegates only music commands and buttons; existing features retain their current paths.

**Tech Stack:** Node.js 20+, ESM, discord.js 14, discord-player 7, @discord-player/extractor, discord-player-youtubei, ffmpeg-static, node:test.

## Global Constraints

- Inputs: song names, YouTube links, Spotify tracks, and Spotify playlists capped at 50 tracks.
- SoundCloud, lyrics, autoplay, persistent queues, DJ roles, and saved playlists are out of scope.
- Every guild has one independent in-memory queue and at most one active voice channel.
- Every member in the bot's voice channel may use every music control.
- The bot leaves when playback ends or the voice channel becomes empty.
- YouTube uses a replaceable community extractor because Discord Player v7 has no official YouTube extractor.
- Existing commands and lowdb data remain unchanged.

## File Structure

- `music/policy.js`: query limits, voice authorization, volume, and loop decisions.
- `music/panel.js`: current-track embed, queue embed, and Discord button rows.
- `music/player.js`: player initialization, extractors, commands, controls, events, cleanup.
- `test/music-policy.test.js`: pure policy tests.
- `test/music-panel.test.js`: serialized panel tests.
- `test/music-player.test.js`: adapter contract tests with injected dependencies.
- `test/commands.test.js`: slash-command definitions.
- `index.js`: initialize and route music interactions.
- `deploy-commands.js`: register `/play query` and `/music`.
- `package.json`, `package-lock.json`: dependencies and test script.
- `.env.example`, `README.md`: Railway and optional YouTube-cookie notes.

---

### Task 1: Music Policy Core

**Files:**
- Create: `music/policy.js`
- Create: `test/music-policy.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `MAX_PLAYLIST_TRACKS`, `authorizeVoiceControl({ memberChannelId, botChannelId })`, `limitTracks(tracks)`, `stepVolume(current, delta)`, `nextLoopMode(current)`.
- Authorization returns `{ ok: true }` or `{ ok: false, message: string }`.
- Loop mode cycles numeric Discord Player modes `0 -> 1 -> 2 -> 0`.

- [ ] **Step 1: Add the test script and write failing tests**

```json
"scripts": {
  "start": "node index.js",
  "deploy-commands": "node deploy-commands.js",
  "test": "node --test"
}
```

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PLAYLIST_TRACKS, authorizeVoiceControl, limitTracks,
  stepVolume, nextLoopMode
} from '../music/policy.js';

test('playlist imports are capped at 50 tracks', () => {
  const tracks = Array.from({ length: 60 }, (_, id) => ({ id }));
  assert.equal(MAX_PLAYLIST_TRACKS, 50);
  assert.equal(limitTracks(tracks).length, 50);
});

test('voice controls require the same connected channel', () => {
  assert.deepEqual(authorizeVoiceControl({ memberChannelId: null, botChannelId: 'a' }),
    { ok: false, message: '请先加入语音频道。' });
  assert.deepEqual(authorizeVoiceControl({ memberChannelId: 'b', botChannelId: 'a' }),
    { ok: false, message: '你需要和 Bot 在同一个语音频道。' });
  assert.deepEqual(authorizeVoiceControl({ memberChannelId: 'a', botChannelId: 'a' }), { ok: true });
});

test('volume stays between 0 and 100', () => {
  assert.equal(stepVolume(95, 10), 100);
  assert.equal(stepVolume(5, -10), 0);
});

test('loop mode cycles off, track, queue, off', () => {
  assert.equal(nextLoopMode(0), 1);
  assert.equal(nextLoopMode(1), 2);
  assert.equal(nextLoopMode(2), 0);
});
```

- [ ] **Step 2: Verify the tests fail for the missing module**

Run: `npm test -- test/music-policy.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `music/policy.js`.

- [ ] **Step 3: Implement the minimal policy module**

```js
export const MAX_PLAYLIST_TRACKS = 50;
export const limitTracks = tracks => tracks.slice(0, MAX_PLAYLIST_TRACKS);

export function authorizeVoiceControl({ memberChannelId, botChannelId }) {
  if (!memberChannelId) return { ok: false, message: '请先加入语音频道。' };
  if (botChannelId && memberChannelId !== botChannelId) {
    return { ok: false, message: '你需要和 Bot 在同一个语音频道。' };
  }
  return { ok: true };
}

export const stepVolume = (current, delta) => Math.max(0, Math.min(100, current + delta));
export const nextLoopMode = current => current === 0 ? 1 : current === 1 ? 2 : 0;
```

- [ ] **Step 4: Verify the policy tests pass**

Run: `npm test -- test/music-policy.test.js`

Expected: 4 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add package.json music/policy.js test/music-policy.test.js
git commit -m "Add tested music policy core"
```

### Task 2: Music Panel Presentation

**Files:**
- Create: `music/panel.js`
- Create: `test/music-panel.test.js`

**Interfaces:**
- Consumes queue fields `currentTrack`, `tracks`, `node.volume`, `node.isPaused()`, `repeatMode`.
- Produces: `buildMusicPanel(queue) -> { embeds, components }`, `buildQueueEmbed(queue) -> EmbedBuilder`.
- Button IDs: `music_previous`, `music_pause`, `music_skip`, `music_stop`, `music_shuffle`, `music_loop`, `music_queue`, `music_volume_down`, `music_volume_up`.

- [ ] **Step 1: Write failing panel serialization tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMusicPanel, buildQueueEmbed } from '../music/panel.js';

const queue = {
  currentTrack: {
    title: 'Test Song', url: 'https://example.com', author: 'Artist',
    duration: '3:20', requestedBy: { id: '123' }, thumbnail: null
  },
  tracks: { size: 2, toArray: () => [{ title: 'Next 1' }, { title: 'Next 2' }] },
  node: { volume: 60, isPaused: () => false }, repeatMode: 0
};

test('panel displays metadata and two valid action rows', () => {
  const panel = buildMusicPanel(queue);
  assert.equal(panel.embeds[0].toJSON().title, 'MUSIC PANEL');
  assert.match(panel.embeds[0].toJSON().description, /Test Song/);
  assert.deepEqual(panel.components.map(row => row.components.length), [4, 5]);
});

test('queue view lists upcoming tracks', () => {
  const json = buildQueueEmbed(queue).toJSON();
  assert.match(json.description, /1\. Next 1/);
  assert.match(json.description, /2\. Next 2/);
});
```

- [ ] **Step 2: Verify the tests fail for the missing panel**

Run: `npm test -- test/music-panel.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `music/panel.js`.

- [ ] **Step 3: Implement the panel**

Use `EmbedBuilder`, `ActionRowBuilder`, `ButtonBuilder`, and `ButtonStyle`. The green-accented embed contains linked title, requester, duration, author, queue count, volume, and loop label. Row one has Previous, Pause/Resume, Skip, Stop. Row two has Shuffle, Loop, Queue, Volume Down, Volume Up. The pause label follows `queue.node.isPaused()` and every emoji must be accepted by Discord components.

- [ ] **Step 4: Verify all tests**

Run: `npm test`

Expected: 6 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add music/panel.js test/music-panel.test.js
git commit -m "Add music control panel"
```

### Task 3: Discord Player Runtime Adapter

**Files:**
- Create: `music/player.js`
- Create: `test/music-player.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `createMusicService(client, options?) -> Promise<{ handleCommand, handleButton, destroy }>`.
- Tests pass `{ player, loadExtractors: false }`; production constructs the player.
- Both handlers return `true` when handled and `false` otherwise.

- [ ] **Step 1: Install runtime packages**

Run: `npm install discord-player@^7 @discord-player/extractor@^7 discord-player-youtubei ffmpeg-static`

Expected: lockfile updates and install exits 0.

- [ ] **Step 2: Write a failing adapter contract test**

Use an injected fake player and fake interaction. Assert a non-music command returns `false`; assert `/play` with no member voice channel returns `true` and replies privately with `请先加入语音频道。`.

- [ ] **Step 3: Verify the adapter test fails**

Run: `npm test -- test/music-player.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `music/player.js`.

- [ ] **Step 4: Initialize player and extractors**

Set `process.env.FFMPEG_PATH ||= ffmpegPath`, construct `new Player(client)`, load `SpotifyExtractor`, and register `YoutubeiExtractor`. Register `playerStart`, `playerError`, `error`, `emptyQueue`, and `emptyChannel`. Queue options: `leaveOnEnd`, `leaveOnEmpty`, and `leaveOnStop` true; end cooldown 15 seconds; empty cooldown 60 seconds.

- [ ] **Step 5: Implement `/play` and `/music`**

Validate guild and member voice state, reject a different active bot channel, and defer `/play`. Search with `requestedBy`, cap playlist tracks with `limitTracks`, serialize queue changes with `queue.tasksQueue`, start when idle, then show `buildMusicPanel`. `/music` shows the current panel or privately reports `目前没有歌曲正在播放。`.

- [ ] **Step 6: Implement all buttons**

Require same-channel access and acknowledge quickly. Map IDs to history previous, pause toggle, skip, queue delete, shuffle, loop cycle, private queue embed, and volume steps of 10. Refresh the original panel after state changes. Convert source and player failures into short private Chinese messages.

- [ ] **Step 7: Verify tests and binaries**

Run: `npm test`

Run: `node -e "import('ffmpeg-static').then(x => console.log(x.default)); import('discord-player-youtubei').then(x => console.log(Boolean(x.YoutubeiExtractor)))"`

Expected: all tests pass, an FFmpeg path prints, extractor prints `true`.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json music/player.js test/music-player.test.js
git commit -m "Add Discord music player runtime"
```

### Task 4: Bot Integration And Commands

**Files:**
- Modify: `index.js`
- Modify: `deploy-commands.js`
- Create: `test/commands.test.js`

**Interfaces:**
- Consumes: `createMusicService(client)`.
- Existing handlers run unchanged when music handlers return `false`.

- [ ] **Step 1: Write a failing command-definition test**

Refactor `deploy-commands.js` to export `commands` while keeping direct execution. Assert `play` has one required string option named `query`, `music` exists, and neither has default member permissions.

- [ ] **Step 2: Verify the command test fails**

Run: `npm test -- test/commands.test.js`

Expected: FAIL because `commands` is not exported and music commands do not exist.

- [ ] **Step 3: Register public commands**

```js
new SlashCommandBuilder()
  .setName('play')
  .setDescription('播放或加入歌曲')
  .addStringOption(option => option
    .setName('query')
    .setDescription('歌名、YouTube 或 Spotify 链接')
    .setRequired(true)),
new SlashCommandBuilder()
  .setName('music')
  .setDescription('显示音乐控制面板')
```

- [ ] **Step 4: Route music interactions**

Import and initialize `createMusicService` after constructing `client`. Call `handleCommand` before the existing command switch and `handleButton` before giveaway/team button handling. Return immediately when handled.

- [ ] **Step 5: Verify tests and syntax**

Run: `npm test`

Run: `node --check index.js`

Run: `node --check deploy-commands.js`

Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add index.js deploy-commands.js test/commands.test.js
git commit -m "Integrate music commands"
```

### Task 5: Railway Documentation And Live Verification

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Documents optional sensitive `YOUTUBE_COOKIE` and automatic `FFMPEG_PATH` behavior.
- No secret values are committed.

- [ ] **Step 1: Document music operation**

Add `/play`, `/music`, supported sources, Spotify-to-playable-source bridging, 50-track cap, same-channel controls, restart-cleared queues, FFmpeg packaging, Railway resource impact, and optional `YOUTUBE_COOKIE` for challenged Railway IPs.

- [ ] **Step 2: Run complete automated verification**

Run: `npm test`

Run: `node --check index.js`

Run: `node --check deploy-commands.js`

Run: `git diff --check`

Expected: zero failures and zero whitespace errors.

- [ ] **Step 3: Register commands and smoke-test startup**

Run: `npm run deploy-commands`

Run: `npm start`

Expected: registration succeeds, bot logs in, extractors load, no startup exception occurs.

- [ ] **Step 4: Test in the Discord draft channel**

Join a test voice channel. Verify a song-name search, YouTube link, Spotify track, and Spotify playlist. Exercise every control, test rejection outside the voice channel, leave the channel, and confirm automatic cleanup. Delete test messages afterward.

- [ ] **Step 5: Commit documentation and push after live verification**

```bash
git add .env.example README.md
git commit -m "Document music player deployment"
git push origin main
```

Do not push if YouTube playback, Spotify bridging, or automatic disconnect remains unverified; report the exact blocker.
