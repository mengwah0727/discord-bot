import test from 'node:test';
import assert from 'node:assert/strict';
import { isDirectMediaLink, resolveLinkResult } from '../music/resolver.js';

test('detects YouTube and Spotify links but not song names', () => {
  assert.equal(isDirectMediaLink('https://www.youtube.com/watch?v=abc'), true);
  assert.equal(isDirectMediaLink('https://youtu.be/abc'), true);
  assert.equal(isDirectMediaLink('https://open.spotify.com/track/abc?si=1'), true);
  assert.equal(isDirectMediaLink('Never Gonna Give You Up'), false);
});

test('direct links are converted to text search tracks', async () => {
  const source = {
    tracks: [{ title: 'The Moment', author: 'Terence Lam' }],
    setTracks(tracks) {
      this.tracks = tracks;
      return this;
    }
  };
  const queries = [];
  const result = await resolveLinkResult({
    input: 'https://open.spotify.com/track/123',
    result: source,
    search: async query => {
      queries.push(query);
      return { tracks: [{ title: 'Playable result', query }] };
    }
  });

  assert.deepEqual(queries, ['The Moment Terence Lam']);
  assert.equal(result.tracks[0].title, 'Playable result');
});

test('song-name searches keep their original tracks and enforce the limit', async () => {
  const source = {
    tracks: Array.from({ length: 60 }, (_, id) => ({ id })),
    setTracks(tracks) {
      this.tracks = tracks;
      return this;
    }
  };
  let searches = 0;
  const result = await resolveLinkResult({
    input: 'playlist by name',
    result: source,
    search: async () => {
      searches += 1;
      return { tracks: [] };
    }
  });

  assert.equal(searches, 0);
  assert.equal(result.tracks.length, 50);
});
