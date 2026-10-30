// A build with VITE_MULTIPLAYER=off (vite.config.ts defines __RH_MULTIPLAYER__ = false): online play is switched off
// and the game never asks a relay anything. Each test file runs in its own process, so the flag set here stays here.
import { test } from 'node:test';
import assert from 'node:assert/strict';

(globalThis as { __RH_MULTIPLAYER__?: boolean }).__RH_MULTIPLAYER__ = false;

test('VITE_MULTIPLAYER=off: online play is off and the relay is never contacted', async () => {
  const { MULTIPLAYER } = await import('../src/config');
  assert.equal(MULTIPLAYER, false, 'the flag reads as off');
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => { calls++; throw new Error('no requests expected'); }) as typeof fetch;
  try {
    const { serverStatus } = await import('../src/net/endpoint');
    const s = await serverStatus(true);
    assert.deepEqual(s, { ok: false }, 'the relay reads as unavailable');
    assert.equal(calls, 0, 'without a single request');
  } finally {
    globalThis.fetch = realFetch;
  }
});
