import { limitTracks } from './policy.js';

const DIRECT_MEDIA_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'open.spotify.com'
]);

export function isDirectMediaLink(input) {
  try {
    return DIRECT_MEDIA_HOSTS.has(new URL(input).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function trackSearchText(track) {
  const title = String(track?.title || '').trim();
  const author = String(track?.author || '').trim();
  return `${title} ${author}`.trim();
}

async function resolveTracks(tracks, search, concurrency = 4) {
  const resolved = new Array(tracks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tracks.length) {
      const index = nextIndex++;
      const query = trackSearchText(tracks[index]);
      if (!query) continue;

      try {
        const searchResult = await search(query);
        resolved[index] = searchResult.tracks[0] || null;
      } catch {
        resolved[index] = null;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tracks.length) }, () => worker())
  );

  return resolved.filter(Boolean);
}

export async function resolveLinkResult({ input, result, search }) {
  const tracks = limitTracks(result.tracks);
  if (!isDirectMediaLink(input)) return result.setTracks(tracks);

  const playableTracks = await resolveTracks(tracks, search);
  return result.setTracks(playableTracks);
}
