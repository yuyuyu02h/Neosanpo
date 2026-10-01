import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNetwork,
  findRoute,
  elementRings,
  segmentBlocked,
  routeProgress,
  type OSMElement,
} from '../src/navigation.ts';
import { placesFromNetwork } from '../src/places.ts';
import type { Coordinate } from '../src/types.ts';
const origin: Coordinate = [139, 35];
const way = (
  id: number,
  points: Coordinate[],
  tags: Record<string, string> = { highway: 'footway' },
): OSMElement => ({
  id,
  type: 'way',
  tags,
  nodes: points.map((_, i) => id * 100 + i),
  geometry: points.map(([lon, lat]) => ({ lon, lat })),
});
const polygon = (tags: Record<string, string>): OSMElement =>
  way(
    99,
    [
      [139.001, 34.999],
      [139.002, 34.999],
      [139.002, 35.001],
      [139.001, 35.001],
      [139.001, 34.999],
    ],
    tags,
  );
test('道路に沿ったL字の経路を作り、建物間の直線にはしない', () => {
  const net = buildNetwork([way(1, [origin, [139, 35.002], [139.002, 35.002]])], origin);
  const route = findRoute(net, origin, '102');
  assert.ok(route);
  assert.ok(route.distance > 390);
  assert.ok(route.coordinates.some((p) => p[0] === 139 && p[1] === 35.002));
  const places = placesFromNetwork(net, origin);
  assert.ok(places.length > 0);
  assert.ok(places.every((p) => net.nodes.has(p.nodeId)));
  assert.equal(routeProgress(route, origin).offRoute, false);
  assert.equal(routeProgress(route, [139.005, 35]).offRoute, true);
});
test('大学・学校・軍用地・私有地・建物を横切る線分を除外（端点が外でも）', () => {
  for (const tags of [
    { amenity: 'university' },
    { amenity: 'school' },
    { landuse: 'military' },
    { access: 'private' },
    { building: 'apartments' },
  ]) {
    const net = buildNetwork([way(1, [origin, [139.003, 35]]), polygon(tags)], origin);
    assert.equal(net.nodes.size, 0, JSON.stringify(tags));
    assert.equal(placesFromNetwork(net, origin).length, 0);
  }
});
test('私道・駐車場通路・高速道路・歩行禁止・条件付き通行路を候補にしない', () => {
  for (const tags of [
    { highway: 'footway', access: 'private' },
    { highway: 'service', service: 'driveway' },
    { highway: 'motorway' },
    { highway: 'residential', foot: 'no' },
    { highway: 'path' },
    { highway: 'footway', 'access:conditional': 'yes @ (08:00-17:00)' },
  ]) {
    assert.equal(
      buildNetwork([way(1, [origin, [139, 35.002]], tags)], origin).nodes.size,
      0,
      JSON.stringify(tags),
    );
  }
});
test('店の中心ではなく隣接する道路上へ配置、切れた道は選ばない', () => {
  const shop: OSMElement = {
    id: 9,
    type: 'node',
    lon: 139.0003,
    lat: 35.0016,
    tags: { shop: 'convenience', name: 'テスト店' },
  };
  const net = buildNetwork(
    [
      way(1, [origin, [139, 35.003]]),
      way(2, [
        [139.005, 35],
        [139.005, 35.002],
      ]),
      shop,
    ],
    origin,
  );
  const places = placesFromNetwork(net, origin);
  assert.ok(places.length);
  assert.ok(places.every((p) => p.coordinate[0] === 139));
  assert.ok(places.some((p) => p.realName.includes('テスト店')));
  assert.equal(findRoute(net, origin, '201'), null);
});
test('学校の点しかない場合も周囲を除外し、ゲートを通過させない', () => {
  const school: OSMElement = {
    id: 9,
    type: 'node',
    lon: 139,
    lat: 35.001,
    tags: { amenity: 'school' },
  };
  assert.equal(buildNetwork([way(1, [origin, [139, 35.002]]), school], origin).nodes.size, 0);
  const barrier: OSMElement = {
    id: 101,
    type: 'node',
    lon: 139,
    lat: 35.001,
    tags: { barrier: 'gate' },
  };
  const net = buildNetwork([way(1, [origin, [139, 35.001], [139, 35.002]]), barrier], origin);
  assert.equal(net.nodes.size, 0);
});
test('大学のmultipolygonを分割された境界から復元し、欠損時は失敗する', () => {
  const parts = polygon({ amenity: 'university' }).geometry!;
  const relation: OSMElement = {
    id: 10,
    type: 'relation',
    tags: { amenity: 'university', type: 'multipolygon' },
    members: [
      { type: 'way', role: 'outer', geometry: parts.slice(0, 3) },
      { type: 'way', role: 'outer', geometry: parts.slice(2) },
    ],
  };
  const rings = elementRings(relation);
  assert.equal(rings.length, 1);
  assert.equal(segmentBlocked(origin, [139.003, 35], rings), true);
  assert.throws(() => elementRings({ ...relation, members: relation.members!.slice(0, 1) }));
});

test('区域の境界が欠ける場合は候補の生成を止める', () => {
  const road = way(1, [origin, [139, 35.002]]);
  const incomplete = {
    ...polygon({ amenity: 'university' }),
    geometry: polygon({}).geometry!.slice(0, 3),
  };
  assert.throws(() => buildNetwork([road, incomplete], origin));
  assert.throws(() =>
    buildNetwork(
      [
        road,
        {
          id: 88,
          type: 'relation',
          tags: { type: 'multipolygon', access: 'private' },
          members: [{ type: 'way', role: 'outer' }],
        },
      ],
      origin,
    ),
  );
  assert.equal(
    buildNetwork([road, polygon({ landuse: 'education' })], origin).nodes.size > 0,
    true,
  );
  const through = way(2, [origin, [139.003, 35]]);
  assert.equal(buildNetwork([through, polygon({ landuse: 'education' })], origin).nodes.size, 0);
});
