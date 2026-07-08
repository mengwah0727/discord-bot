import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMusicPanel, buildQueueEmbed } from '../music/panel.js';

function makeQueue(overrides = {}) {
  return {
    currentTrack: {
      title: 'Test Song',
      url: 'https://example.com/song',
      author: 'Artist',
      duration: '3:20',
      requestedBy: { id: '123' },
      thumbnail: null
    },
    tracks: {
      size: 2,
      toArray: () => [{ title: 'Next 1', duration: '2:00' }, { title: 'Next 2', duration: '4:00' }]
    },
    node: { volume: 60, isPaused: () => false },
    repeatMode: 0,
    ...overrides
  };
}

test('panel displays metadata and two valid action rows', () => {
  const panel = buildMusicPanel(makeQueue());
  const embed = panel.embeds[0].toJSON();
  assert.equal(embed.title, 'MUSIC PANEL');
  assert.match(embed.description, /Test Song/);
  assert.match(embed.description, /Artist/);
  assert.match(embed.description, /<@123>/);
  assert.deepEqual(panel.components.map(row => row.components.length), [4, 5]);
});

test('pause button changes to resume while paused', () => {
  const queue = makeQueue({ node: { volume: 60, isPaused: () => true } });
  const button = buildMusicPanel(queue).components[0].components[1].toJSON();
  assert.equal(button.label, '继续');
});

test('queue view lists upcoming tracks', () => {
  const embed = buildQueueEmbed(makeQueue()).toJSON();
  assert.match(embed.description, /1\. Next 1/);
  assert.match(embed.description, /2\. Next 2/);
});
