import test from 'node:test';
import assert from 'node:assert/strict';
import { distance, validCoordinate } from '../src/geo.ts';
import { accurateFix, advanceEvidence, startEvidence, pickupState } from '../src/walking.ts';
import { emptySave, parseSave } from '../src/storage.ts';
import { placesFromOSM } from '../src/places.ts';
import { items } from '../src/items.ts';
import type { Coordinate, LocationFix } from '../src/types.ts';

const origin: Coordinate = [139, 35];
const target: Coordinate = [139, 35.0018];
const fix = (
  step = 0,
  seconds = step * 5,
  accuracy = 5,
  speed: number | null = 1,
): LocationFix => ({
  coordinate: [139, 35 + step * 0.000045],
  timestamp: 100000 + seconds * 1000,
  accuracy,
  speed,
});
function walked() {
  let evidence = startEvidence(fix());
  for (let step = 1; step <= 40; step++) {
    const f = fix(step);
    evidence = advanceEvidence(evidence, f, target, f.timestamp);
  }
  return evidence;
}

test('座標と測地距離', () => {
  assert.equal(distance(origin, origin), 0);
  assert.ok(Math.abs(distance([0, 0], [0, 1]) - 111195) < 2);
  for (const v of [[181, 35], [139, 91], [NaN, 35], ['139', 35], null])
    assert.equal(validCoordinate(v), false);
});
test('静止・誤差の範囲の揺れだけでは歩行にならない', () => {
  let evidence = startEvidence(fix());
  for (let i = 1; i <= 100; i++) {
    const f = fix(i % 2 ? 0.5 : 0, i * 5);
    evidence = advanceEvidence(evidence, f, target, f.timestamp);
  }
  assert.equal(evidence.totalDistance, 0);
  assert.equal(pickupState(evidence, evidence.last, target, evidence.last.timestamp), 'walking');
});
test('最初から目的地にいるだけでは拾えない', () => {
  let evidence = startEvidence(fix(40, 0));
  for (let i = 1; i <= 20; i++) {
    const f = fix(40, i * 5, 5, 0);
    evidence = advanceEvidence(evidence, f, target, f.timestamp);
  }
  assert.equal(pickupState(evidence, evidence.last, target, evidence.last.timestamp), 'walking');
});
test('連続歩行と到着を確認した場合だけ取得可能', () => {
  const evidence = walked();
  assert.ok(evidence.continuousDistance >= 40);
  assert.equal(pickupState(evidence, evidence.last, target, evidence.last.timestamp), 'ready');
  assert.equal(
    pickupState(evidence, evidence.last, target, evidence.last.timestamp + 10001),
    'position',
  );
});
test('位置の飛び・車両速度・中断は連続歩行をリセット', () => {
  const evidence = walked();
  for (const f of [fix(150, 205), fix(40, 205, 5, 10), fix(40, 220)]) {
    const next = advanceEvidence(evidence, f, target, f.timestamp);
    assert.equal(next.continuousDistance, 0);
    assert.notEqual(pickupState(next, f, target, f.timestamp), 'ready');
  }
});
test('精度不足・未来・古い測位・測位の再送を受理しない', () => {
  assert.equal(accurateFix(fix(0, 0, 26), 100000), false);
  assert.equal(accurateFix(fix(), 99999), false);
  assert.equal(accurateFix(fix(), 110001), false);
  const evidence = walked();
  assert.deepEqual(advanceEvidence(evidence, fix(100, 200), target, 300000), evidence);
  const bad = fix(40, 205, 120);
  const next = advanceEvidence(evidence, bad, target, bad.timestamp);
  assert.equal(pickupState(next, bad, target, bad.timestamp), 'position');
  assert.equal(advanceEvidence(next, fix(40, 210), target, 310000).continuousDistance, 0);
});
test('到着の安定は8秒・3測位が必要、離れたら失効', () => {
  let evidence = walked();
  evidence = { ...evidence, arrivalSince: null, arrivalSamples: 0 };
  for (const seconds of [205, 209]) {
    const f = fix(40, seconds, 5, 0);
    evidence = advanceEvidence(evidence, f, target, f.timestamp);
    assert.equal(pickupState(evidence, f, target, f.timestamp), 'settling');
  }
  const arrived = fix(40, 213, 5, 0);
  evidence = advanceEvidence(evidence, arrived, target, arrived.timestamp);
  assert.equal(pickupState(evidence, arrived, target, arrived.timestamp), 'ready');
  const away = fix(30, 218);
  evidence = advanceEvidence(evidence, away, target, away.timestamp);
  assert.notEqual(pickupState(evidence, away, target, away.timestamp), 'ready');
});
test('旧デモ取得を引き継がず、実散歩の記録だけv2へ移行', () => {
  const find = {
    id: 'a',
    itemId: 'robot',
    placeId: 'osm-node-1',
    placeName: 'ベンチ',
    foundAt: '2026-09-30T00:00:00Z',
    mode: 'live',
  };
  const migrated = parseSave(
    JSON.stringify({
      version: 1,
      finds: [find, { ...find, id: 'b', mode: 'demo' }, { ...find, itemId: 'unknown' }],
      walks: [],
    }),
  );
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.finds, [find]);
  assert.deepEqual(parseSave(null), emptySave());
  assert.throws(() => parseSave('{broken'));
  assert.throws(() => parseSave('{"version":3,"finds":[],"walks":[]}'));
});
test('周辺候補は120m以上・1400m以内、私有地と密集を除外', () => {
  const nodes = [
    { id: 1, type: 'node', lon: 139, lat: 35, tags: { amenity: 'bench' } },
    { id: 2, type: 'node', lon: 139, lat: 35.0018, tags: { amenity: 'bench' } },
    { id: 3, type: 'node', lon: 139, lat: 35.00181, tags: { amenity: 'bench' } },
    { id: 4, type: 'node', lon: 139, lat: 35.003, tags: { amenity: 'bench', access: 'private' } },
    { id: 5, type: 'node', lon: 139, lat: 36, tags: { amenity: 'bench' } },
    { id: 6, type: 'node', lon: 139, lat: 35.0036, tags: { amenity: 'drinking_water' } },
  ];
  assert.deepEqual(
    placesFromOSM(nodes, origin).map((p) => p.id),
    ['osm-node-2', 'osm-node-6'],
  );
  assert.deepEqual(placesFromOSM(nodes, origin), placesFromOSM(nodes, origin));
});
test('12種類が独立した品として存在', () => {
  assert.equal(items.length, 12);
  assert.equal(new Set(items.map((i) => i.id)).size, 12);
});
