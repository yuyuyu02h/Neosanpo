import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { installGPS, click, emit, bench } from './gps-harness.mjs';

const url = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installGPS(context);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://overpass-api.de/api/interpreter', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ elements: [bench] }) }),
  );
  await page.goto(url);
  assert.equal(await page.locator('.maplibregl-canvas').count(), 0, 'GPS取得前は地図を作らない');
  await page.screenshot({ path: 'test-results/v2-mobile-entry.png' });
  for (const [width, height] of [
    [375, 667],
    [1440, 960],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({ path: `test-results/v2-entry-${width}.png` });
  }
  await click(page, 'use-location');
  await emit(page, 34.6939, 135.5023, 0, 100);
  assert.equal(
    await page.locator('.maplibregl-canvas').count(),
    0,
    '粗い位置では固定の地図へ逃げない',
  );
  await emit(page, 34.6939, 135.5023);
  await page.locator('.quest-place').filter({ hasText: '検証用ベンチ' }).waitFor();
  await page.locator('#map-status').waitFor({ state: 'hidden', timeout: 35000 });
  assert.equal(
    await page.locator('[data-action="demo-step"], [data-action="use-demo"]').count(),
    0,
  );
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'test-results/v2-mobile-map.png' });
  await click(page, 'start');
  await page.setViewportSize({ width: 375, height: 667 });
  // 地図操作の画角だけを更新し、現在地や歩行証拠は変更しない。
  await click(page, 'stop-walk');
  await click(page, 'start');
  await page.waitForTimeout(1200);
  const cardBounds = await page.locator('#quest-card').boundingBox();
  for (const selector of ['.traveler-marker', '.drop-marker']) {
    const bounds = await page.locator(selector).boundingBox();
    assert.ok(bounds.y > 150 && bounds.y + bounds.height / 2 < cardBounds.y);
  }
  await page.screenshot({ path: 'test-results/v2-walking-small.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  for (let i = 0; i < 15; i++) await emit(page, 34.6939, 135.5023);
  assert.equal(await page.locator('[data-action="discover"]').count(), 0, '静止中は取得不可');
  await click(page, 'center');
  assert.match(await page.locator('.walk-status').innerText(), /歩行：0 m/);
  await emit(page, bench.lat, bench.lon, 1);
  for (let i = 0; i < 5; i++) await emit(page, bench.lat, bench.lon);
  assert.equal(await page.locator('[data-action="discover"]').count(), 0, '瞬間移動後も取得不可');
  await click(page, 'stop-walk');
  await emit(page, 34.6939, 135.5023);
  await click(page, 'search-nearby');
  await page.locator('[data-action="start"]').waitFor();
  await click(page, 'start');
  // GPS測位を5秒間隔・約5mずつ進める。アプリ側の位置を書き換えるAPIは使わない。
  for (let step = 1; step <= 40; step++) await emit(page, 34.6939 + step * 0.000045, 135.5023);
  await emit(page, bench.lat, bench.lon, 5, 5, 0);
  await page.locator('[data-action="discover"]').waitFor();
  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'test-results/v2-arrival.png' });
  await click(page, 'discover');
  await page.screenshot({ path: 'test-results/v2-discovery.png' });
  await click(page, 'keep');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mayoimichi:v2')));
  assert.equal(saved.version, 2);
  assert.equal(saved.finds.length, 1);
  assert.equal(saved.finds[0].mode, 'live');
  assert.ok(saved.walks[0].distance >= 40);
  assert.equal(await page.locator('[data-action="keep"]:visible').count(), 0);
  await page.reload();
  assert.equal(
    await page.locator('.maplibregl-canvas').count(),
    0,
    '再起動でも現在地の再取得が必要',
  );
  await click(page, 'nav-collection');
  assert.equal(await page.locator('.item-card').count(), 1);
  await page.screenshot({ path: 'test-results/v2-collection.png' });
  await page.locator('.item-card').click();
  const download = page.waitForEvent('download');
  await click(page, 'download-item');
  assert.match((await download).suggestedFilename(), /\.svg$/);
  await click(page, 'close-dialog');
  await click(page, 'nav-journal');
  const dataDownload = page.waitForEvent('download');
  await click(page, 'export');
  assert.match((await dataDownload).suggestedFilename(), /\.json$/);
  await context.close();

  const denied = await browser.newContext({ viewport: { width: 375, height: 667 } });
  await installGPS(denied);
  const p = await denied.newPage();
  await p.goto(url);
  await click(p, 'use-location');
  await p.evaluate(() => window.__testGPS.fail());
  assert.match(await p.locator('.location-message').innerText(), /許可されていません/);
  assert.equal(await p.locator('.maplibregl-canvas').count(), 0);
  assert.equal(await p.locator('[data-action="start"], [data-action="discover"]').count(), 0);
  await p.screenshot({ path: 'test-results/v2-location-denied.png' });
  await denied.close();
  assert.deepEqual(errors, []);
  console.log(
    'PASS: 現在地必須 / 実地図 / 静止・瞬間移動の取得拒否 / 連続歩行→到着→取得 / 永続化 / SVG・JSON出力 / 3画面幅 / GPS拒否',
  );
} finally {
  await browser.close();
}
