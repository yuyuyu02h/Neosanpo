import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { installGPS, click, emit } from './gps-harness.mjs';
const browser = await chromium.launch({ headless: true });
const url = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installGPS(context);
  const page = await context.newPage();
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort());
  await page.route('https://overpass-api.de/api/interpreter', (route) =>
    route.fulfill({ status: 503, body: 'unavailable' }),
  );
  await page.route('https://api.openstreetmap.org/api/0.6/map?*', (route) =>
    route.fulfill({ status: 503, body: 'unavailable' }),
  );
  await page.goto(url);
  await click(page, 'use-location');
  await emit(page, 34.6939, 135.5023);
  await page.locator('#map-status.error').waitFor({ timeout: 25000 });
  await page.locator('#quest-card').filter({ hasText: '気配を見失ってしまった' }).waitFor();
  await page.unroute('https://tiles.openfreemap.org/**');
  await click(page, 'retry-map');
  await page.locator('#map-status').waitFor({ state: 'hidden', timeout: 35000 });
  await page.unroute('https://api.openstreetmap.org/api/0.6/map?*');
  await page.route('https://api.openstreetmap.org/api/0.6/map?*', (route) =>
    route.fulfill({
      contentType: 'application/xml',
      body: '<osm><node id="990" lon="135.5023" lat="34.6957"><tag k="amenity" v="bench"/><tag k="name" v="予備経路のベンチ"/></node></osm>',
    }),
  );
  await click(page, 'search-nearby');
  await page.locator('.quest-place').filter({ hasText: '予備経路のベンチ' }).waitFor();
  await context.close();
  const broken = await browser.newContext();
  await broken.addInitScript(() => localStorage.setItem('mayoimichi:v2', '{broken'));
  const storage = await broken.newPage();
  await storage.goto(url);
  await storage.locator('#storage-warning').waitFor();
  // UI操作後も破損データを消さない。
  await click(storage, 'nav-journal');
  assert.equal(await storage.evaluate(() => localStorage.getItem('mayoimichi:v2')), '{broken');
  await broken.close();
  console.log('PASS: 地図障害→再試行 / 周辺検索障害→再検索 / OSM予備経路 / 破損保存データの保持');
} finally {
  await browser.close();
}
