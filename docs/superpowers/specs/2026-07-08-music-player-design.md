# Music Player Design

## Goal

Add a reliable music experience to the existing Discord bot without coupling playback failures to team, giveaway, schedule, or temporary voice features.

## Supported Inputs

- Song names and search phrases.
- YouTube video and playlist links.
- Spotify track and playlist links.
- Spotify playlists add at most the first 50 playable tracks.
- SoundCloud is intentionally out of scope.

Spotify provides track metadata rather than a directly playable audio stream. The player resolves each Spotify track to an equivalent playable source before playback.

## Commands

### `/play query`

The user must be connected to a voice channel. The bot joins that channel, resolves the query, starts playback when idle, or appends the result to that guild's queue. The response displays the music control panel.

### `/music`

Shows or refreshes the control panel for the current guild queue. It reports clearly when nothing is playing.

## Control Panel

The panel displays:

- Current song title and link.
- Author or artist.
- Duration.
- Requesting member.
- Remaining queue size.
- Current loop and volume state.

Controls are arranged in compact Discord action rows:

1. Previous, pause/resume, skip, stop.
2. Shuffle, loop, queue, volume down, volume up.

Discord limits each action row to five components, so the controls cannot all occupy one physical row. Button colors remain restrained and consistent with the bot's existing style.

## Permissions And Voice Rules

- Any member in the same voice channel as the bot may use every music control.
- Members outside that voice channel receive a private error response.
- A `/play` request from another voice channel is rejected while the bot is already active.
- Existing server permissions for unrelated bot features are unchanged.

## Playback Lifecycle

- Each guild has an independent queue and player state.
- Playback advances automatically when a track finishes.
- The bot disconnects when the queue ends.
- The bot also disconnects and clears the queue after the voice channel becomes empty.
- Playback errors skip the failed track, notify the text channel briefly, and continue with the next queued track when possible.
- Interaction handlers acknowledge button clicks quickly to avoid Discord interaction timeouts.

## Architecture

Music behavior lives in a dedicated module rather than expanding the existing command file with playback internals. The module owns player initialization, guild queue access, search limits, panel rendering, authorization, controls, events, and cleanup.

The existing entry point only initializes the module and routes `/play`, `/music`, and music component interactions to it. Command registration remains in the existing deployment script.

The implementation uses Discord Player and its maintained extractors, with FFmpeg available in the Railway runtime. Exact package versions are pinned by the lockfile.

## Data And Persistence

Music queues are intentionally held in memory. They are cleared when Railway restarts or redeploys. No queue data is written to lowdb because stale voice sessions cannot be resumed safely after a process restart.

## Railway Deployment

- The Node.js process remains the existing Railway service.
- FFmpeg availability is verified during implementation; a packaged binary is used if Railway does not provide one reliably.
- Startup fails with a clear diagnostic if required voice or audio dependencies are unavailable.
- The feature does not require Spotify Premium. Any provider credentials required by the selected extractor are documented in `.env.example` without committing secrets.

## Testing

Automated tests cover query and playlist limits, voice-channel authorization, button state, panel rendering, queue transitions, and cleanup decisions.

Manual verification covers song-name search, YouTube links, Spotify tracks and playlists, the 50-track cap, all panel controls, different-channel rejection, and automatic disconnect.

## Out Of Scope

- SoundCloud.
- Persistent queues across restarts.
- Lyrics, autoplay recommendations, saved personal playlists, and DJ roles.
- Simultaneous playback in more than one voice channel within the same guild.
