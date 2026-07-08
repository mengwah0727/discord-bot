export const MAX_PLAYLIST_TRACKS = 50;

export function limitTracks(tracks) {
  return tracks.slice(0, MAX_PLAYLIST_TRACKS);
}

export function authorizeVoiceControl({ memberChannelId, botChannelId }) {
  if (!memberChannelId) {
    return { ok: false, message: '请先加入语音频道。' };
  }

  if (botChannelId && memberChannelId !== botChannelId) {
    return { ok: false, message: '你需要和 Bot 在同一个语音频道。' };
  }

  return { ok: true };
}

export function stepVolume(current, delta) {
  return Math.max(0, Math.min(100, current + delta));
}

export function nextLoopMode(current) {
  return current === 0 ? 1 : current === 1 ? 2 : 0;
}
