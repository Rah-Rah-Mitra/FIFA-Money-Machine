import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDetails, normalizePlayback, buildStreamUrl } from '../src/fifa';
import { aggregate } from '../src/events';

test('normalizeDetails maps FIFA fields and flattens tags', () => {
  const raw = {
    videoEntryId: '7w5eTQ8xbmnSNHypyuYhdG',
    title: 'Argentina v Algeria',
    description: 'Highlights',
    duration: 134.144,
    dateOfRelease: '2026-06-20T00:00:00Z',
    dateOfLastEdit: '2026-06-21T00:00:00Z',
    videoCategory: 'Highlights',
    videoSubcategory: 'Group Stage',
    semanticTags: [
      { title: 'FIFA World Cup 26', source: 'tournament', sourceCategory: 'Tournament', id: 't1' },
      { title: 'Argentina', source: 'team', sourceCategory: 'Team', id: 't2' },
    ],
    tournamentLogo: { title: 'WC26', src: 'logo.png' },
  };
  const d = normalizeDetails(raw);
  assert.equal(d.id, '7w5eTQ8xbmnSNHypyuYhdG');
  assert.equal(d.durationSeconds, 134.144);
  assert.equal(d.releaseDate, '2026-06-20T00:00:00Z');
  assert.equal(d.lastEdited, '2026-06-21T00:00:00Z');
  assert.deepEqual(d.tags, ['FIFA World Cup 26', 'Argentina']);
  assert.equal(d.tournament, 'FIFA World Cup 26');
});

test('buildStreamUrl produces the Uplynk preplay URL with appended signature', () => {
  const url = buildStreamUrl('7ceca2267d374d54bec3433c5ca5b13e', {
    queryStr: 'v=2&tc=1%2C-1&rn=1717138280&exp=1782534343&ct=a&cid=7ceca2267d374d54bec3433c5ca5b13e',
    signature: 'c38ad3fa4c68ed01fa282107475ed9840d836f09af5525b1154b903bba07e643',
  });
  assert.equal(
    url,
    'https://content.uplynk.com/preplay/7ceca2267d374d54bec3433c5ca5b13e.json?v=2&tc=1%2C-1&rn=1717138280&exp=1782534343&ct=a&cid=7ceca2267d374d54bec3433c5ca5b13e&sig=c38ad3fa4c68ed01fa282107475ed9840d836f09af5525b1154b903bba07e643',
  );
});

test('normalizePlayback maps Uplynk bundle, drops labels, surfaces token expiry', () => {
  const raw = {
    videoType: 0,
    title: 'Argentina v Algeria',
    description: 'Highlights',
    videoPosterImage: { src: 'poster.jpg', alt: 'Argentina v Algeria', width: 3840, height: 2160 },
    externalVerizonAssetId: 'p6fshkFkLUWGe57JIS2RmQ',
    verizonAssetGuid: '7ceca2267d374d54bec3433c5ca5b13e',
    duration: 134.144,
    requiresToken: true,
    requiresDRM: false,
    preplayParameters: {
      contentId: '7ceca2267d374d54bec3433c5ca5b13e',
      preplayAPIVersion: '2',
      tokenCheckAlgorithmVersion: '1,-1',
      contentType: 'a',
      randomNumber: '1717138280',
      tokenExpirationDate: '1782534343',
      signature: 'c38ad3fa4c68ed01fa282107475ed9840d836f09af5525b1154b903bba07e643',
      queryStr: 'v=2&tc=1%2C-1&rn=1717138280&exp=1782534343&ct=a&cid=7ceca2267d374d54bec3433c5ca5b13e',
      disallowedCountryCodes: '',
      adConfiguration: 'desktop_vod',
      adPreroll: true,
      adPostroll: false,
    },
    videoPlayerLabels: { liveStreamLoadError: 'should be dropped' },
  };
  const pb = normalizePlayback(raw) as any;
  assert.equal(pb.uplynk.assetGuid, '7ceca2267d374d54bec3433c5ca5b13e');
  assert.equal(pb.poster.width, 3840);
  assert.equal(pb.requiresToken, true);
  assert.equal(pb.ads.preroll, true);
  assert.ok(pb.streamUrl.startsWith('https://content.uplynk.com/preplay/'));
  assert.equal(pb.tokenExpiration, new Date(1782534343 * 1000).toISOString());
  assert.equal('videoPlayerLabels' in pb, false); // labels dropped
});

test('aggregate computes views, completion, and decile retention', () => {
  // session A watches to 100% and completes; B reaches 50%; C reaches 10%.
  const rows = [
    { session_id: 'A', type: 'play', position_seconds: 0, duration_seconds: 100 },
    { session_id: 'A', type: 'complete', position_seconds: 100, duration_seconds: 100 },
    { session_id: 'B', type: 'heartbeat', position_seconds: 50, duration_seconds: 100 },
    { session_id: 'C', type: 'heartbeat', position_seconds: 10, duration_seconds: 100 },
  ];
  const a = aggregate(rows);
  assert.equal(a.views, 3);
  assert.equal(Math.round(a.avgWatchTimeSeconds), Math.round((100 + 50 + 10) / 3));
  assert.equal(Math.round(a.completionRate * 100), 33); // only A
  // decile 1 (10%): A,B,C reached -> 1.0 ; decile 5 (50%): A,B -> 0.667 ; decile 10: A -> 0.333
  assert.equal(a.dropoff[0], 1);
  assert.equal(Math.round(a.dropoff[4] * 100), 67);
  assert.equal(Math.round(a.dropoff[9] * 100), 33);
});
