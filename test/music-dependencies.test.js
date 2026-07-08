import test from 'node:test';
import assert from 'node:assert/strict';

test('Discord DAVE voice encryption support is installed', async () => {
  const davey = await import('@snazzah/davey');
  assert.ok(davey);
});

test('music source and FFmpeg dependencies are loadable', async () => {
  const [{ YoutubeiExtractor }, { SpotifyExtractor }, ffmpeg] = await Promise.all([
    import('discord-player-youtubei'),
    import('@discord-player/extractor'),
    import('ffmpeg-static')
  ]);
  assert.equal(typeof YoutubeiExtractor, 'function');
  assert.equal(typeof SpotifyExtractor, 'function');
  assert.equal(typeof ffmpeg.default, 'string');
});
