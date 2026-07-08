import test from 'node:test';
import assert from 'node:assert/strict';
import { createMusicService } from '../music/player.js';

function makePlayer() {
  return {
    nodes: { get: () => null },
    events: { on: () => {} },
    on: () => {},
    destroy: () => {}
  };
}

test('registers diagnostics for tracks skipped before playback', async () => {
  const eventNames = [];
  const player = makePlayer();
  player.events.on = name => eventNames.push(name);

  await createMusicService({}, { player, loadExtractors: false });

  assert.ok(eventNames.includes('playerSkip'));
});

test('non-music commands are ignored', async () => {
  const service = await createMusicService({}, { player: makePlayer(), loadExtractors: false });
  const handled = await service.handleCommand({ commandName: 'wwm-create' });
  assert.equal(handled, false);
});

test('play requires the requester to join a voice channel', async () => {
  const service = await createMusicService({}, { player: makePlayer(), loadExtractors: false });
  const replies = [];
  const interaction = {
    commandName: 'play',
    guildId: 'guild-1',
    member: { voice: { channelId: null, channel: null } },
    reply: async payload => replies.push(payload)
  };

  const handled = await service.handleCommand(interaction);

  assert.equal(handled, true);
  assert.deepEqual(replies, [{ content: '请先加入语音频道。', ephemeral: true }]);
});

test('non-music buttons are ignored', async () => {
  const service = await createMusicService({}, { player: makePlayer(), loadExtractors: false });
  const handled = await service.handleButton({ customId: 'team_delete_1' });
  assert.equal(handled, false);
});
