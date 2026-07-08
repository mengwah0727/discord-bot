import test from 'node:test';
import assert from 'node:assert/strict';
import { musicCommands } from '../music/commands.js';

test('music slash commands are public and have the expected options', () => {
  const commands = musicCommands.map(command => command.toJSON());
  const play = commands.find(command => command.name === 'play');
  const music = commands.find(command => command.name === 'music');

  assert.ok(play);
  assert.ok(music);
  assert.equal(play.default_member_permissions, undefined);
  assert.equal(music.default_member_permissions, undefined);
  assert.equal(play.options.length, 1);
  assert.equal(play.options[0].name, 'query');
  assert.equal(play.options[0].required, true);
});
