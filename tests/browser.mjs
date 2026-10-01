import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { installGPS, click, emit, roadFixture, origin } from './gps-harness.mjs';
import { placesFromOSM } from '../src/places.ts';
const url = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installGPS(context);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('Failed to load resource'))
      errors.push(m.text());
  });
  await page.route('**/api/interpreter', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ elements: roadFixture }) }),
  );
  await page.goto(url);
  assert.equal(await page.locator('.maplibregl-canvas').count(), 0);
  await page.screenshot({ path: 'test-results/v3-entry.png' });
  await click(page, 'use-location');
  await emit(page, origin[1], origin[0]);
  await page.locator('[data-action=start]').waitFor();
  await page.locator('#map-status').waitFor({ state: 'hidden', timeout: 45000 });
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('[data-action="demo-step"]').count(), 0);
  assert.doesNotMatch(
    await page.locator('#map-view').innerText(),
    /気配|足もと|足元|YOUR STEPS|忘れもの/,
  );
  for (const [width, height] of [
    [390, 844],
    [375, 667],
    [1440, 960],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(500);
    const card = await page.locator('#quest-card').boundingBox();
    assert.ok(card.height <= 96, `操作バーが大きい: ${card.height}`);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({ path: `test-results/v3-map-${width}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await click(page, 'start');
  await page.waitForTimeout(1000);
  assert.equal(
    await page.locator('#world-map').getAttribute('aria-description'),
    '徒歩ルートを表示中',
  );
  await page.screenshot({ path: 'test-results/v3-route.png' });
  await click(page, 'reality');
  await page.waitForTimeout(2500);
  await click(page, 'fantasy');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'test-results/v3-theme-route.png' });
  for (let i = 0; i < 15; i++) await emit(page, origin[1], origin[0]);
  assert.equal(await page.locator('[data-action=discover]').count(), 0);
  const target = placesFromOSM(roadFixture, origin)[0].coordinate;
  await emit(page, target[1], target[0], 1);
  for (let i = 0; i < 6; i++) await emit(page, target[1], target[0]);
  assert.equal(await page.locator('[data-action=discover]').count(), 0, '瞬間移動は取得不可');
  await click(page, 'route-details');
  await click(page, 'stop-walk');
  await emit(page, origin[1], origin[0]);
  await click(page, 'destinations');
  await click(page, 'search-nearby');
  await page.locator('[data-action=start]').waitFor();
  await click(page, 'start');
  const steps = Math.round((target[1] - origin[1]) / 0.000045);
  for (let i = 1; i <= steps; i++) await emit(page, origin[1] + i * 0.000045, origin[0]);
  for (let i = 0; i < 3; i++) await emit(page, target[1], target[0], 5, 5, 0);
  await page.locator('[data-action=discover]').waitFor();
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'test-results/v3-arrival.png' });
  await click(page, 'discover');
  await click(page, 'keep');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mayoimichi:v2')));
  assert.equal(saved.finds.length, 1);
  assert.equal(saved.finds[0].mode, 'live');
  await click(page, 'reality');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'test-results/v3-reality.png' });
  await click(page, 'fantasy');
  await click(page, 'nav-collection');
  assert.equal(await page.locator('.item-card').count(), 1);
  await page.screenshot({ path: 'test-results/v3-collection.png' });
  await page.locator('.item-card').click();
  const download = page.waitForEvent('download');
  await click(page, 'download-item');
  assert.match((await download).suggestedFilename(), /\.svg$/);
  await click(page, 'close-dialog');
  await click(page, 'nav-journal');
  const dataDownload = page.waitForEvent('download');
  await click(page, 'export');
  assert.match((await dataDownload).suggestedFilename(), /\.json$/);
  await click(page, 'nav-map');
  await click(page, 'route-details');
  await click(page, 'hide-place');
  assert.equal(
    await page.evaluate(() => JSON.parse(localStorage.getItem('neosanpo:hidden-places')).length),
    1,
  );
  await page.reload();
  await click(page, 'nav-collection');
  assert.equal(await page.locator('.item-card').count(), 1);
  await context.close();
  const denied = await browser.newContext({ viewport: { width: 375, height: 667 } });
  await installGPS(denied);
  const p = await denied.newPage();
  await p.goto(url);
  await click(p, 'use-location');
  await p.evaluate(() => window.__testGPS.fail());
  assert.match(await p.locator('.location-message').innerText(), /許可されていません/);
  assert.equal(await p.locator('.maplibregl-canvas').count(), 0);
  await denied.close();
  assert.deepEqual(errors, []);
  console.log(
    'PASS: 3画面幅の小型操作バー / AI地図 / 徒歩ルート / 静止・瞬間移動の拒否 / 歩行→取得 / 保存・書き出し / 地点非表示 / GPS拒否',
  );
} finally {
  await browser.close();
}
