import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createYoutubeDlStream } from '../music/youtube-stream.js';

test('yt-dlp stream uses stdout audio and the Node JavaScript runtime', () => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const calls = [];
  const process = {
    stdout,
    stderr,
    killed: false,
    kill() { this.killed = true; },
    catch() { return this; }
  };

  const stream = createYoutubeDlStream(
    { url: 'https://youtube.com/watch?v=test1234567', live: false },
    (url, options) => {
      calls.push({ url, options });
      return process;
    }
  );

  assert.equal(stream, stdout);
  assert.equal(calls[0].url, 'https://youtube.com/watch?v=test1234567');
  assert.equal(calls[0].options.format, 'bestaudio');
  assert.equal(calls[0].options.output, '-');
  assert.equal(calls[0].options.jsRuntimes, 'node');
});
