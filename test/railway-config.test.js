import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Railway image installs production dependencies and starts the bot', () => {
  const dockerfile = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /RUN npm ci --omit=dev/);
  assert.match(dockerfile, /CMD \["npm", "start"\]/);
});
