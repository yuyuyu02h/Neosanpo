import test from 'node:test';
import assert from 'node:assert/strict';
import { structuresFromOSM, structureFeatures } from '../src/structures.ts';
import type { OSMElement } from '../src/navigation.ts';
const building = (id: number): OSMElement => ({
  type: 'way',
  id,
  tags: { building: 'yes' },
  geometry: [
    { lon: 139, lat: 35 },
    { lon: 139.0003, lat: 35 },
    { lon: 139.0003, lat: 35.0003 },
    { lon: 139, lat: 35.0003 },
    { lon: 139, lat: 35 },
  ],
});
const elements = Array.from({ length: 30 }, (_, i) => building(i + 1));
test('同じ建物IDは取得順・隣の建物追加・再読込相当の再計算でも同じ配置', () => {
  const initial = structuresFromOSM(elements);
  assert.ok(initial.length);
  assert.deepEqual(structuresFromOSM([...elements].reverse()), initial);
  const expanded = structuresFromOSM([...elements, building(99)]);
  for (const original of initial)
    assert.deepEqual(
      expanded.find((s) => s.id === original.id),
      original,
    );
  assert.deepEqual(structuresFromOSM(JSON.parse(JSON.stringify(elements))), initial);
});
test('配置データは画面・ズームの情報を持たず、OSMの固定IDと座標を保持する', () => {
  const structures = structuresFromOSM(elements);
  const features = structureFeatures(structures);
  for (let i = 0; i < structures.length; i++) {
    assert.equal(features.features[i].id, structures[i].id);
    assert.deepEqual(features.features[i].geometry.coordinates, structures[i].coordinate);
    assert.ok(features.features[i].properties!.size16 > 0);
  }
});
