import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { installGPS, click, emit, origin } from './gps-harness.mjs';
const url = process.env.BASE_URL ?? 'http://127.0.0.1:5180';
const [x, y] = origin;
const polygon = (id, cx, cy, half, tags) => ({
  type: 'way',
  id,
  tags,
  geometry: [
    [cx - half, cy - half],
    [cx + half, cy - half],
    [cx + half, cy + half],
    [cx - half, cy + half],
    [cx - half, cy - half],
  ].map(([lon, lat]) => ({ lon, lat })),
});
const house = polygon(900, x, y, 0.00012, { building: 'house', access: 'private' });
const road = {
  type: 'way',
  id: 1,
  nodes: [101, 102, 103],
  tags: { highway: 'residential', sidewalk: 'no' },
  geometry: [
    { lon: x + 0.0005, lat: y - 0.001 },
    { lon: x + 0.0005, lat: y + 0.0015 },
    { lon: x + 0.0005, lat: y + 0.004 },
  ],
};
const scenery = Array.from({ length: 24 }, (_, i) =>
  polygon(i + 1, x - 0.0006 - (i % 4) * 0.0003, y - 0.001 + Math.floor(i / 4) * 0.0004, 0.00009, {
    building: 'yes',
  }),
);
const elements = [house, road, ...scenery];
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch();
try {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installGPS(c);
  const p = await c.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.route('**/src/map.ts*', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    assert.ok(body.includes('this.map = new maplibregl.Map'));
    await route.fulfill({
      response,
      body: body.replace(
        'this.map = new maplibregl.Map',
        'window.__map = this.map = new maplibregl.Map',
      ),
    });
  });
  await p.route('**/api/interpreter', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ elements }) }),
  );
  const launch = async () => {
    await p.goto(url);
    await click(p, 'use-location');
    await emit(p, y, x);
    await p.locator('[data-action=start]').waitFor();
    await p.locator('#map-status').waitFor({ state: 'hidden', timeout: 45000 });
  };
  const data = () =>
    p.evaluate(async () => {
      const source = window.__map.getSource('fantasy-points');
      return (await source.getData()).features.sort((a, b) => a.id.localeCompare(b.id));
    });
  await launch();
  const initial = await data();
  assert.ok(initial.length >= 3);
  await click(p, 'start');
  await p.waitForTimeout(900);
  const player = await p.locator('.traveler-marker').boundingBox();
  const dock = await p.locator('#quest-card').boundingBox();
  assert.ok(
    player &&
      player.x >= 0 &&
      player.x + player.width <= 390 &&
      player.y >= 0 &&
      player.y + player.height < dock.y,
    '屋内の現在地もルートと一緒に見える',
  );
  assert.match(await p.locator('#toast').innerText(), /近くの道路から/);
  for (let i = 0; i < 12; i++) await emit(p, y, x);
  assert.equal(await p.locator('[data-action=discover]').count(), 0, '家の中では取得できない');
  for (const zoom of [15, 18, 16.8]) {
    await p.evaluate((z) => window.__map.jumpTo({ zoom: z }), zoom);
    await p.waitForTimeout(800);
    assert.deepEqual(await data(), initial);
  }
  await p.evaluate(() => window.__map.panBy([110, 70], { duration: 0 }));
  await p.waitForTimeout(700);
  assert.deepEqual(await data(), initial);
  await click(p, 'reality');
  await p.waitForTimeout(1000);
  await click(p, 'fantasy');
  await p.waitForFunction(() => window.__map?.getSource('fantasy-points'));
  assert.deepEqual(await data(), initial);
  assert.equal(
    await p.evaluate(() =>
      window.__map.getLayoutProperty('fantasy-buildings', 'icon-allow-overlap'),
    ),
    true,
  );
  await p.waitForFunction(() => window.__map.isStyleLoaded(), {}, { timeout: 45000 });
  await p.waitForTimeout(700);
  assert.match(await p.locator('#quest-card').innerText(), /まず道路に出てください/);
  await p.screenshot({ path: 'test-results/v31-fixed-buildings.png' });
  await launch();
  assert.deepEqual(await data(), initial);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: 家の中からルート / 静止時取得不可 / 3倍率・移動・テーマ切替・再読込で建物ID・位置・種類固定',
  );
  await c.close();
} finally {
  await browser.close();
}
