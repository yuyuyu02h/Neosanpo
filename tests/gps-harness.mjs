// テスト専用。アプリの配布コードには読み込まれない。
export async function installGPS(context) {
  await context.addInitScript(() => {
    let now = Date.now();
    Date.now = () => now;
    let success, failure;
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition(ok, error) {
          success = ok;
          failure = error;
          return 1;
        },
        clearWatch() {
          success = undefined;
          failure = undefined;
        },
      },
    });
    window.__testGPS = {
      emit(latitude, longitude, seconds = 5, accuracy = 5, speed = 1) {
        now += seconds * 1000;
        success?.({ timestamp: now, coords: { latitude, longitude, accuracy, speed } });
      },
      fail(code = 1) {
        failure?.({ code });
      },
      age(seconds) {
        now += seconds * 1000;
      },
    };
  });
}
export const click = (page, action) =>
  page.locator(`[data-action="${action}"]:visible`).first().click();
export async function emit(page, latitude, longitude, seconds = 5, accuracy = 5, speed = 1) {
  await page.evaluate(
    (args) => window.__testGPS.emit(...args),
    [latitude, longitude, seconds, accuracy, speed],
  );
}
export const bench = {
  id: 901,
  type: 'node',
  lon: 135.5023,
  lat: 34.6957,
  tags: { amenity: 'bench', name: '検証用ベンチ' },
};
