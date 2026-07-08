import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PLAYLIST_TRACKS,
  authorizeVoiceControl,
  limitTracks,
  stepVolume,
  nextLoopMode
} from '../music/policy.js';

test('playlist imports are capped at 50 tracks', () => {
  const tracks = Array.from({ length: 60 }, (_, id) => ({ id }));
  assert.equal(MAX_PLAYLIST_TRACKS, 50);
  assert.equal(limitTracks(tracks).length, 50);
});

test('voice controls require the same connected channel', () => {
  assert.deepEqual(authorizeVoiceControl({ memberChannelId: null, botChannelId: 'a' }), {
    ok: false,
    message: '请先加入语音频道。'
  });
  assert.deepEqual(authorizeVoiceControl({ memberChannelId: 'b', botChannelId: 'a' }), {
    ok: false,
    message: '你需要和 Bot 在同一个语音频道。'
  });
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
