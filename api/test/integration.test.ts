import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server';

const VID = '7w5eTQ8xbmnSNHypyuYhdG'; // Argentina v Algeria

async function upstreamReachable(): Promise<boolean> {
  try {
    const r = await fetch(`https://cxm-api.fifa.com/fifaplusweb/api/videoPlayerData/${VID}?locale=en`);
    return r.ok;
  } catch {
    return false;
  }
}

test('integration: live playback + details for Argentina v Algeria', async (t) => {
  if (!(await upstreamReachable())) {
    t.skip('FIFA upstream unreachable (offline) — skipping live integration test');
    return;
  }

  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as AddressInfo).port;
  const base = `http://localhost:${port}`;

  try {
    const pb = await (await fetch(`${base}/videos/${VID}/playback`)).json();
    assert.equal(typeof pb.uplynk.assetGuid, 'string');
    assert.ok(pb.streamUrl?.includes('content.uplynk.com'));
    assert.ok(pb.preplay.signature, 'signature present');
    assert.ok(pb.tokenExpiration, 'token expiry surfaced');

    const d = await (await fetch(`${base}/videos/${VID}`)).json();
    assert.ok(d.title?.length, 'has a title');
    assert.equal(typeof d.durationSeconds, 'number');

    const bad = await fetch(`${base}/videos/not-an-id!/playback`);
    assert.equal(bad.status, 400);
  } finally {
    server.close();
  }
});
