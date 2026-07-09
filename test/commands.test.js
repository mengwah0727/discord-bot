import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('music slash commands are removed from the bot', () => {
  const deployCommands = readFileSync(new URL('../deploy-commands.js', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../index.js', import.meta.url), 'utf8');

  assert.equal(deployCommands.includes("setName('play')"), false);
  assert.equal(deployCommands.includes("setName('music')"), false);
  assert.equal(deployCommands.includes('./music/'), false);
  assert.equal(runtime.includes('./music/'), false);
});
