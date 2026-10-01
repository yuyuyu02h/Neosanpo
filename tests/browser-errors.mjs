import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { installGPS, click, emit, roadFixture, origin } from './gps-harness.mjs';
const url = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const b = await chromium.launch();
try {
  const c = await b.newContext({ viewport: { width: 390, height: 844 } });
  await installGPS(c);
  const p = await c.newPage();
  await p.route('https://tiles.openfreemap.org/**', (r) => r.abort());
  await p.route('**/api/interpreter', (r) => r.fulfill({ status: 503, body: 'unavailable' }));
  await p.goto(url);
  await click(p, 'use-location');
  await emit(p, origin[1], origin[0]);
  await p.locator('#map-status.error').waitFor({ timeout: 35000 });
  await p.locator('#quest-card').filter({ hasText: '立入制限の情報を取得できません' }).waitFor();
  assert.equal(await p.locator('.drop-marker').count(), 0, '区域データなしでは配置しない');
  await p.unroute('https://tiles.openfreemap.org/**');
  await click(p, 'retry-map');
  await p.locator('#map-status').waitFor({ state: 'hidden', timeout: 45000 });
  await p.unroute('**/api/interpreter');
  await p.route('**/api/interpreter', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ elements: roadFixture }) }),
  );
  await click(p, 'search-nearby');
  await p.locator('[data-action=start]').waitFor();
  await c.close();
  const bad = await b.newContext();
  await bad.addInitScript(() => localStorage.setItem('mayoimichi:v2', '{broken'));
  const q = await bad.newPage();
  await q.goto(url);
  await q.locator('#storage-warning').waitFor();
  assert.equal(await q.evaluate(() => localStorage.getItem('mayoimichi:v2')), '{broken');
  await bad.close();
  console.log('PASS: 地図再試行 / 区域データ取得失敗時の配置停止 / 再検索 / 破損保存の保持');
} finally {
  await b.close();
}
