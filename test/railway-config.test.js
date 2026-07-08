import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Railway image skips the incorrect YouTube Python preflight', () => {
  const dockerfile = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /ENV YOUTUBE_DL_SKIP_PYTHON_CHECK=1/);
  assert.match(dockerfile, /RUN npm ci --omit=dev/);
  assert.match(dockerfile, /CMD \["npm", "start"\]/);
});
