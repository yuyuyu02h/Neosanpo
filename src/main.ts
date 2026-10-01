import './style.css';
import { WorldMap } from './map.ts';
import { nearbyPlaces } from './places.ts';
import { findRoute, routeProgress, type WalkingNetwork } from './navigation.ts';
import { itemById } from './items.ts';
import { itemArt, landscape, sprig } from './art.ts';
import { icon, escapeHtml as esc } from './icons.ts';
import { distance, formatDistance, nearestPlaces } from './geo.ts';
import { accurateFix, advanceEvidence, pickupState, startEvidence, WALK_RULES } from './walking.ts';
import { loadSave, persist } from './storage.ts';
import type { Coordinate, Find, LocationFix, Place, Session, View } from './types.ts';

const loaded = loadSave();
let save = loaded.data;
const mode = 'live' as const;
let view: View = 'map';
let places: Place[] = [];
let network: WalkingNetwork | null = null;
let offRoute = false;
let remaining = 0;
const hiddenPlaces = new Set<string>();
try {
  const values = JSON.parse(localStorage.getItem('neosanpo:hidden-places') ?? '[]');
  if (Array.isArray(values))
    values.filter((v) => typeof v === 'string').forEach((v) => hiddenPlaces.add(v));
} catch {
  /* 読み取り失敗時は空から開始。 */
}
let selected: Place | undefined;
let position: Coordinate | null = null;
let currentFix: LocationFix | null = null;
let locationError = '';
let mapStarted = false;
let wakeLock: WakeLockSentinel | null = null;
let session: Session | null = null;
let fantasy = true;
let watchId: number | undefined;
let locating = false;
let searchController: AbortController | null = null;
let searching = false;
let searchError = '';
let dialogFind: Find | null = null;
let toastTimeout: ReturnType<typeof setTimeout>;
let soundContext: AudioContext | null = null;
let locationGeneration = 0;

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <aside class="sidebar">
    <a class="brand" href="#" data-action="nav-map">${sprig()}<strong>まよいみち</strong></a>
    <nav class="main-nav" aria-label="メインメニュー">
      <button class="nav-button active" data-action="nav-map">${icon('compass')}地図</button>
      <button class="nav-button" data-action="nav-collection">${icon('bag')}コレクション <b class="collection-count">0</b></button>
      <button class="nav-button" data-action="nav-journal">${icon('book')}散歩の記録</button>
    </nav>
    <img class="sidebar-art" src="/fantasy/tower.webp" alt=""/><button class="text-button" data-action="about">${icon('info', 16)}使い方・設定</button>
  </aside>
  <header class="mobile-header"><a class="brand" href="#" data-action="nav-map">${sprig()}<strong>まよいみち</strong></a><button class="icon-button" data-action="about" aria-label="使い方と設定">${icon('info')}</button></header>
  <main class="main-area">
    <section id="map-view" class="map-view awaiting-location" aria-label="散歩の地図">
      <div id="location-gate" class="location-gate"></div><div id="world-map"></div>
      <div class="map-heading"><button class="mode-pill" data-action="mode"><span class="gps-dot"></span><span id="mode-label">GPS確認中</span></button><span id="region-sub" class="sr-only"></span></div>
      <div class="theme-switch" role="group" aria-label="地図の表示"><button data-action="fantasy" class="active" aria-pressed="true">${icon('spark', 15)}異世界</button><button data-action="reality" aria-pressed="false">${icon('map', 15)}現実</button></div>
      <div class="map-toolbar"><button class="icon-button" data-action="north" aria-label="北向きに戻す">${icon('compass')}</button><div class="toolbar-group"><button class="icon-button" data-action="zoom-in" aria-label="拡大">${icon('plus')}</button><button class="icon-button" data-action="zoom-out" aria-label="縮小">${icon('minus')}</button></div><button class="icon-button locate-button" data-action="center" aria-label="現在地へ">${icon('locate')}</button></div>
      <div id="map-status" class="map-status hidden" role="status"></div>
      <div class="map-bottom"><div id="quest-card" class="quest-card" aria-live="polite"></div></div>
    </section>
    <section id="collection-view" class="content-view hidden" aria-labelledby="collection-title"></section>
    <section id="journal-view" class="content-view hidden" aria-labelledby="journal-title"></section>
  </main>
  <nav class="mobile-nav" aria-label="メニュー"><button data-action="nav-map" class="active">${icon('compass')}<span>地図</span></button><button data-action="nav-collection">${icon('bag')}<span>コレクション <b class="collection-count">0</b></span></button><button data-action="nav-journal">${icon('book')}<span>記録</span></button></nav>
  <dialog id="dialog" aria-labelledby="dialog-title"><button class="dialog-close icon-button" data-action="close-dialog" aria-label="閉じる">${icon('close')}</button><div id="dialog-content"></div></dialog>
  <div id="toast" class="toast" role="status"></div>
  <div id="storage-warning" class="storage-warning hidden" role="alert">保存できません。<button data-action="nav-journal">記録を書き出す</button></div>
`;

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T =>
  document.querySelector<T>(selector)!;
const dialog = $<HTMLDialogElement>('#dialog');
const world = new WorldMap(selectPlace, mapStatus);

function collectedPlaces(): Set<string> {
  return new Set(save.finds.filter((f) => f.mode === mode).map((f) => f.placeId));
}
function availablePlaces(): Place[] {
  if (!position) return [];
  return nearestPlaces(places, position, collectedPlaces()).filter(
    (p) =>
      !hiddenPlaces.has(p.id) && distance(position!, p.coordinate) >= WALK_RULES.minimumDestination,
  );
}
function toast(message: string): void {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => $('#toast').classList.remove('visible'), 4800);
}
function writeSave(): void {
  const failed = loaded.error || !persist(save);
  $('#storage-warning').classList.toggle('hidden', !failed);
  updateCounts();
}
function updateCounts(): void {
  document.querySelectorAll('.collection-count').forEach((e) => {
    e.textContent = String(save.finds.length);
  });
}
function dateText(value: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(value));
}
function sound(): void {
  if (!save.sound) return;
  try {
    soundContext ??= new AudioContext();
    void soundContext.resume();
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      const oscillator = soundContext!.createOscillator();
      const gain = soundContext!.createGain();
      const time = soundContext!.currentTime + index * 0.12;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.08, time + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.7);
      oscillator.connect(gain);
      gain.connect(soundContext!.destination);
      oscillator.start(time);
      oscillator.stop(time + 0.8);
    });
  } catch {
    /* 音が利用できなくても拾得は継続する。 */
  }
}

function mapStatus(state: 'loading' | 'ready' | 'error'): void {
  const element = $('#map-status');
  element.classList.toggle('hidden', state === 'ready');
  element.classList.toggle('error', state === 'error');
  element.innerHTML =
    state === 'error'
      ? `${icon('info')}<span>地図を読み込めませんでした。</span><button data-action="retry-map">もう一度</button>`
      : '<span class="spinner"></span>地図を読み込み中…';
}

function syncMap(): void {
  world.setPlaces(
    session ? [session.place] : availablePlaces(),
    selected?.id ?? '',
    collectedPlaces(),
  );
  if (position) world.setPlayer(position, false);
}
function selectPlace(id: string): void {
  if (session) {
    toast('いまの散歩を終えてから、次の目的地を選べます。');
    return;
  }
  const place = availablePlaces().find((p) => p.id === id);
  if (!place) return;
  selected = place;
  syncMap();
  world.setRoute(null);
  world.frameDestination(place.coordinate);
  renderQuest();
}

function pickupReady(): boolean {
  return (
    !!session &&
    pickupState(session.evidence, currentFix, session.place.coordinate, Date.now()) === 'ready'
  );
}

function renderGate(): void {
  if (position) return;
  $('#location-gate').innerHTML =
    `<div class="location-intro"><div class="entry-art"><img src="/fantasy/castle.webp" alt="森に囲まれた石造りの城"/></div><h1>いつもの街を、<br>違う世界で歩こう。</h1><p>近くのアイテムを選んで、歩いて取りに行く。<br>まずは現在地の地図を開きます。</p><button class="primary-button" data-action="use-location" ${locating ? 'disabled' : ''}>${locating ? '<span class="spinner"></span>現在地を確認中' : `${icon('locate', 19)}現在地から始める`}</button><p class="location-message" role="status">${esc(locationError || '位置情報の利用を許可してください。')}</p><button class="text-button" data-action="phone-help">スマホでの使い方</button><p class="privacy-note">現在地を地図サービスへ送信します。<br>移動の履歴は保存しません。</p></div>`;
}

function renderQuest(): void {
  const card = $('#quest-card');
  renderGate();
  updateRegion();
  if (!position) {
    card.innerHTML = '';
    return;
  }
  if (searching) {
    card.innerHTML = `<div class="dock-message"><span class="spinner"></span><span>近くの道路を確認中…</span><button class="text-button" data-action="cancel-search">中止</button></div>`;
    return;
  }
  const place = session?.place ?? selected;
  if (!place) {
    card.innerHTML = `<div class="dock-message"><span>${esc(searchError || '近くに行ける場所が見つかりませんでした。')}</span><button class="primary-button" data-action="search-nearby">再検索</button></div>`;
    return;
  }
  const state = session
    ? pickupState(session.evidence, currentFix, place.coordinate, Date.now())
    : null;
  const ready = state === 'ready';
  const fresh = accurateFix(currentFix, Date.now());
  const item = itemById(place.itemId);
  const meters = session ? remaining : place.routeDistance;
  const note = locationError
    ? 'GPSを再確認してください'
    : !fresh
      ? 'GPSを確認中'
      : offRoute
        ? 'ルートを外れています'
        : ready
          ? '到着しました'
          : state === 'settling'
            ? '到着を確認中…'
            : session
              ? `徒歩ルート · 残り${formatDistance(meters)}`
              : `${esc(place.realName)} · 約${Math.max(1, Math.ceil(meters / 70))}分`;
  card.innerHTML = `<div class="dock-row"><button class="dock-item" data-action="route-details" aria-label="${esc(place.name)}の詳細">${itemArt(item.art)}</button><button class="dock-copy" data-action="${session ? 'route-details' : 'destinations'}"><strong>${esc(place.name)}</strong><span class="quest-place">${note}</span></button><button class="primary-button dock-action" data-action="${!session ? 'start' : ready ? 'discover' : offRoute ? 'reroute' : 'route-details'}" ${!session && !fresh ? 'disabled' : ''}>${!session ? 'ルートを表示' : ready ? '拾う' : offRoute ? '再検索' : `${formatDistance(meters)} ${icon('arrow', 15)}`}</button></div>`;
}

function navigate(next: View): void {
  view = next;
  for (const name of ['map', 'collection', 'journal'] as View[]) {
    $(`#${name}-view`).classList.toggle('hidden', name !== next);
    document.querySelectorAll(`[data-action="nav-${name}"]`).forEach((e) => {
      e.classList.toggle('active', name === next);
      if (name === next) e.setAttribute('aria-current', 'page');
      else e.removeAttribute('aria-current');
    });
  }
  if (next === 'map') requestAnimationFrame(() => world.resize());
  if (next === 'collection') renderCollection();
  if (next === 'journal') renderJournal();
}

function renderCollection(): void {
  const finds = [...save.finds].reverse();
  $('#collection-view').innerHTML =
    `<div class="page-heading"><h2 id="collection-title">コレクション</h2><p>散歩で見つけたアイテム</p><span class="page-count">${finds.length}<small>個</small></span></div>${
      finds.length
        ? `<div class="item-grid">${finds
            .map((find, i) => {
              const item = itemById(find.itemId);
              return `<button class="item-card" data-action="item-detail" data-id="${esc(find.id)}"><div class="item-picture" style="--item-color:${item.color}"><span class="item-number">NO. ${String(finds.length - i).padStart(3, '0')}</span>${itemArt(item.art)}</div><div class="item-card-copy"><h3>${item.name}</h3><p>${item.subtitle}</p><span>${dateText(find.foundAt)} ${icon('arrow', 15)}</span></div></button>`;
            })
            .join('')}</div>`
        : `<div class="empty-state"><div class="empty-illustration">${itemArt('key')}</div><h3>まだアイテムはありません</h3><p>地図から目的地を選んで歩いてみてください。</p><button class="primary-button" data-action="nav-map">地図を開く ${icon('arrow', 18)}</button></div>`
    }`;
}

function renderJournal(): void {
  const realWalks = save.walks.filter((w) => w.mode === 'live');
  const total = realWalks.reduce((sum, walk) => sum + walk.distance, 0);
  $('#journal-view').innerHTML =
    `<div class="page-heading"><h2 id="journal-title">散歩の記録</h2><p>歩いた距離と見つけたアイテム</p><button class="outline-button export-button" data-action="export">${icon('download', 16)}記録を書き出す</button></div><div class="journal-stats"><div><span>確認できた歩行距離</span><strong>${formatDistance(total)}</strong></div><div><span>散歩</span><strong>${realWalks.length}<small>回</small></strong></div><div><span>アイテム</span><strong>${save.finds.length}<small>個</small></strong></div></div>${
      save.walks.length
        ? `<div class="journal-list">${[...save.walks]
            .reverse()
            .map((walk) => {
              const find = save.finds.find((f) => f.id === walk.findId)!;
              const item = itemById(find.itemId);
              return `<button class="journal-entry" data-action="item-detail" data-id="${esc(find.id)}"><div class="journal-art" style="background:${item.color}">${itemArt(item.art)}</div><div><span class="entry-date">${dateText(walk.endedAt)}</span><h3>${item.name}を拾った日</h3><p>${esc(find.placeName)}</p></div><span class="entry-distance">${formatDistance(walk.distance)}${icon('arrow', 17)}</span></button>`;
            })
            .join('')}</div>`
        : `<div class="journal-empty">${landscape}<h3>まだ記録はありません</h3><p>散歩で何かを拾うと、ここに記録が残ります。</p><button class="text-button" data-action="nav-map">地図を開く ${icon('arrow', 16)}</button></div>`
    }<p class="storage-note">記録はこのブラウザに保存されます。位置の履歴は保存しません。<br>距離はGPSの誤差を除いた目安です。実際の歩行より短く表示する場合があります。</p>`;
}

function showDialog(content: string, className = ''): void {
  dialog.className = className;
  $('#dialog-content').innerHTML = content;
  if (!dialog.open) dialog.showModal();
}
function closeDialog(): void {
  dialog.close();
  dialogFind = null;
}

function showMode(): void {
  showDialog(
    `<h2 id="dialog-title">位置情報</h2><p class="dialog-lead">${accurateFix(currentFix, Date.now()) ? `位置精度：約${Math.round(currentFix!.accuracy)}m` : '正確な現在地を取得できていません。'}</p><button class="primary-button" data-action="use-location">${icon('locate', 18)}現在地を再取得</button><p class="privacy-note">端末で「正確な位置情報」を許可してください。散歩中は画面を開いたまま使います。</p>`,
  );
}

function showPhoneHelp(): void {
  showDialog(
    `<h2 id="dialog-title">スマホでの使い方</h2><div class="about-steps"><p><b>1</b> HTTPSのアプリURLをSafariかChromeで開く。</p><p><b>2</b> 「現在地から始める」を押して位置情報を許可。</p><p><b>3</b> アイテムを選び「ルートを表示」。画面を開いたまま歩く。</p><p><b>4</b> 到着したら「拾う」で追加。</p></div><p class="privacy-note">PCのlocalhostはスマホから開けません。ホーム画面に追加して使うこともできます。</p><button class="primary-button" data-action="close-dialog">閉じる</button>`,
  );
}

function showDestinations(): void {
  const available = availablePlaces();
  showDialog(
    `<h2 id="dialog-title">近くのアイテム</h2><div class="destination-list">${available.map((p) => `<button data-action="choose-place" data-id="${esc(p.id)}"><span class="destination-art">${itemArt(itemById(p.itemId).art)}</span><span><strong>${esc(p.name)}</strong><small>${esc(p.realName)}</small></span><span class="destination-distance">${formatDistance(p.routeDistance)}${icon('arrow', 14)}</span></button>`).join('') || '<p>近くに候補がありません。</p>'}</div><button class="outline-button" data-action="search-nearby">${icon('refresh', 16)}周辺を再検索</button>`,
  );
}
function showRouteDetails(): void {
  const place = session?.place ?? selected;
  if (!place) return;
  showDialog(
    `<h2 id="dialog-title">${esc(place.name)}</h2><p class="dialog-lead">${esc(place.realName)}</p><div class="route-summary">${icon('walk', 24)}<strong>${formatDistance(session ? remaining : place.routeDistance)}</strong><span>徒歩 約${Math.max(1, Math.ceil((session ? remaining : place.routeDistance) / 70))}分</span></div><p class="privacy-note">道路データから作った徒歩ルートです。現地の通行規制に従ってください。</p>${session ? `<button class="primary-button" data-action="overview-route">ルート全体を見る</button><button class="outline-button" data-action="stop-walk">ルートを終了</button>` : '<button class="primary-button" data-action="start">ルートを表示</button>'}<button class="text-button report-button" data-action="hide-place">この場所には行けない · 非表示にする</button>`,
  );
}
function hidePlace(): void {
  const place = session?.place ?? selected;
  if (!place) return;
  hiddenPlaces.add(place.id);
  try {
    localStorage.setItem('neosanpo:hidden-places', JSON.stringify([...hiddenPlaces]));
  } catch {
    toast('この端末へ保存できませんでした。');
  }
  session = null;
  releaseScreen();
  world.setRoute(null);
  closeDialog();
  selected = availablePlaces()[0];
  syncMap();
  renderQuest();
  toast('この場所を非表示にしました。');
}
function reroute(): void {
  if (!session || !network || !position || !accurateFix(currentFix, Date.now())) return;
  const route = findRoute(network, position, session.place.nodeId);
  if (!route || route.coordinates.length < 2) {
    toast('現在地から通れる道を確認できません。道に戻って再検索してください。');
    return;
  }
  session.route = route;
  remaining = route.distance;
  offRoute = false;
  world.setRoute(route.coordinates);
  renderQuest();
  world.frameDestination(session.place.coordinate);
}

async function keepScreenAwake(): Promise<void> {
  try {
    if (
      'wakeLock' in navigator &&
      document.visibilityState === 'visible' &&
      (!wakeLock || wakeLock.released)
    )
      wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    /* 非対応端末でもGPSによる散歩を続ける。 */
  }
}
function releaseScreen(): void {
  void wakeLock?.release();
  wakeLock = null;
}
function startWalk(): void {
  if (!selected || session || !currentFix || !accurateFix(currentFix, Date.now())) return;
  if (distance(currentFix.coordinate, selected.coordinate) < WALK_RULES.minimumDestination) {
    selected = availablePlaces()[0];
    syncMap();
    renderQuest();
    toast('120m以上離れた目的地を選んでください。');
    return;
  }
  if (!network) return;
  const route = findRoute(network, currentFix.coordinate, selected.nodeId);
  if (!route || route.coordinates.length < 2) {
    toast('現在地からの徒歩ルートが見つかりません。');
    return;
  }
  closeDialog();
  remaining = route.distance;
  offRoute = false;
  world.setRoute(route.coordinates);
  session = {
    route,
    place: selected,
    startedAt: new Date().toISOString(),
    evidence: startEvidence(currentFix),
  };
  void keepScreenAwake();
  syncMap();
  renderQuest();
  world.frameDestination(selected.coordinate);
  toast('徒歩ルートを表示しました。');
}

function showDiscovery(): void {
  if (!session || !pickupReady()) {
    toast('目的地の近くで、現在地が確認できると拾えます。');
    return;
  }
  const item = itemById(session.place.itemId);
  showDialog(
    `<div class="discovery-art" style="--item-color:${item.color}">${itemArt(item.art)}<span class="discovery-spark a">✧</span><span class="discovery-spark b">✧</span></div><div class="discovery-copy"><h2 id="dialog-title">${item.name}</h2><p class="item-subtitle">${item.subtitle}</p><p class="item-description">${item.description}</p><p class="item-note">${item.note}</p><button class="primary-button" data-action="keep">コレクションに追加 ${icon('bag', 18)}</button></div>`,
    'item-dialog',
  );
}

function keepItem(): void {
  if (!session || !pickupReady()) {
    closeDialog();
    toast('現在地をもう一度確認してから拾ってください。');
    return;
  }
  if (collectedPlaces().has(session.place.id)) return;
  const now = new Date().toISOString();
  const find: Find = {
    id: crypto.randomUUID(),
    itemId: session.place.itemId,
    placeId: session.place.id,
    placeName: session.place.realName,
    foundAt: now,
    mode,
  };
  save.finds.push(find);
  save.walks.push({
    id: crypto.randomUUID(),
    findId: find.id,
    startedAt: session.startedAt,
    endedAt: now,
    distance: Math.round(session.evidence.totalDistance),
    mode,
  });
  session = null;
  world.setRoute(null);
  releaseScreen();
  writeSave();
  selected = availablePlaces()[0];
  syncMap();
  renderQuest();
  closeDialog();
  sound();
  toast(`${itemById(find.itemId).name}を追加しました。`);
  if (view === 'collection') renderCollection();
}

function showItem(id: string): void {
  const find = save.finds.find((f) => f.id === id);
  if (!find) return;
  dialogFind = find;
  const item = itemById(find.itemId);
  showDialog(
    `<div class="discovery-art" style="--item-color:${item.color}">${itemArt(item.art)}</div><div class="discovery-copy"><span class="eyebrow">${dateText(find.foundAt)}</span><h2 id="dialog-title">${item.name}</h2><p class="item-subtitle">${item.subtitle}</p><p class="item-description">${item.description}</p><p class="item-note">${item.note}</p><div class="found-location">${icon('pin', 15)}${esc(find.placeName)}</div><button class="outline-button" data-action="download-item">${icon('download', 16)}この品のカードを保存</button></div>`,
    'item-dialog',
  );
}

function stopLocation(): void {
  locationGeneration++;
  if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
  watchId = undefined;
}
function cancelSearch(): void {
  searchController?.abort();
  searchController = null;
  searching = false;
  locating = false;
}

function updateRegion(): void {
  const fresh = accurateFix(currentFix, Date.now());
  $('#region-sub').textContent = fresh
    ? `現在地の地図 · 位置精度 約${Math.round(currentFix!.accuracy)}m`
    : '現在地を確認しています';
  $('#mode-label').textContent = fresh ? 'GPS接続中' : 'GPS確認待ち';
}

function useLocation(): void {
  closeDialog();
  navigate('map');
  if (!navigator.geolocation || !window.isSecureContext) {
    locationError = 'スマホの位置情報を使うには、HTTPSのアプリURLで開いてください。';
    renderQuest();
    return;
  }
  cancelSearch();
  stopLocation();
  locating = true;
  locationError = '';
  renderQuest();
  if (session) session.evidence.interrupted = true;
  const generation = locationGeneration;
  watchId = navigator.geolocation.watchPosition(
    (result) => {
      if (generation !== locationGeneration) return;
      const fix: LocationFix = {
        coordinate: [result.coords.longitude, result.coords.latitude],
        accuracy: result.coords.accuracy,
        timestamp: result.timestamp,
        speed:
          Number.isFinite(result.coords.speed) && result.coords.speed! >= 0
            ? result.coords.speed
            : null,
      };
      currentFix = fix;
      if (session)
        session.evidence = advanceEvidence(
          session.evidence,
          fix,
          session.place.coordinate,
          Date.now(),
        );
      if (!accurateFix(fix, Date.now())) {
        locationError = `位置を正確に確認しています（誤差 約${Math.round(fix.accuracy)}m）。空の見える場所でお待ちください。`;
        renderQuest();
        return;
      }
      const first = !mapStarted;
      locating = false;
      locationError = '';
      position = fix.coordinate;
      if (first) {
        mapStarted = true;
        $('#location-gate').classList.add('hidden');
        $('#map-view').classList.remove('awaiting-location');
        void world.init(position);
      }
      world.setPlayer(position);
      if (session) {
        const progress = routeProgress(session.route, position);
        remaining = progress.remaining;
        offRoute = progress.offRoute;
      }
      updateRegion();
      if (
        !session &&
        selected &&
        distance(position, selected.coordinate) < WALK_RULES.minimumDestination
      ) {
        selected = availablePlaces()[0];
        syncMap();
      }
      if (first || (!session && places.length === 0 && !searching && !searchError))
        void searchNearby();
      renderQuest();
    },
    (error) => {
      if (generation !== locationGeneration) return;
      locating = false;
      currentFix = null;
      if (session) {
        session.evidence.interrupted = true;
        session.evidence.arrivalSince = null;
        session.evidence.arrivalSamples = 0;
      }
      locationError =
        error.code === 1
          ? '位置情報が許可されていません。スマホの設定で、このサイトの位置情報と正確な位置を許可してください。'
          : '現在地を確認できませんでした。屋外で位置情報を再確認してください。';
      if (error.code === 1) stopLocation();
      renderQuest();
      if (position) toast(locationError);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
  );
}

async function searchNearby(): Promise<void> {
  if (session || !position) return;
  if (!accurateFix(currentFix, Date.now())) {
    toast('正確な現在地を確認してから周辺を探します。');
    return;
  }
  closeDialog();
  searchController?.abort();
  const controller = new AbortController();
  searchController = controller;
  searching = true;
  searchError = '';
  renderQuest();
  try {
    const found = await nearbyPlaces(position, controller.signal);
    if (controller.signal.aborted) return;
    network = found.network;
    places = found.places;
    selected = availablePlaces()[0];
    if (places.length === 0)
      searchError = '近くに歩けるルートが見つかりません。公共の道路で再検索してください。';
    syncMap();
    if (selected) world.frameDestination(selected.coordinate);
  } catch (error) {
    if (!controller.signal.aborted) {
      places = [];
      selected = undefined;
      searchError = error instanceof Error ? error.message : '通信を確認してください。';
      syncMap();
    }
  } finally {
    if (searchController === controller) {
      searching = false;
      searchController = null;
      renderQuest();
    }
  }
}

function exportData(): void {
  download(
    new Blob([JSON.stringify(save, null, 2)], { type: 'application/json' }),
    `mayoimichi-${new Date().toISOString().slice(0, 10)}.json`,
  );
  toast('散歩の記録を書き出しました。');
}
function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadItem(): void {
  if (!dialogFind) return;
  const item = itemById(dialogFind.itemId);
  const art = itemArt(item.art).replace('<svg ', '<svg x="130" y="65" width="340" height="340" ');
  const lines = item.description.split('\n').flatMap((line) => line.match(/.{1,23}/gu) ?? ['']);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800"><rect width="600" height="800" fill="#f4f0e3"/><rect x="28" y="28" width="544" height="744" rx="4" fill="none" stroke="#b9bca5"/><circle cx="300" cy="235" r="145" fill="${item.color}"/>${art}<g text-anchor="middle" fill="#294a3b" font-family="serif"><text x="300" y="441" font-size="28">${esc(item.name)}</text><text x="300" y="479" font-size="16">${esc(item.subtitle)}</text>${lines.map((line, i) => `<text x="300" y="532" dy="${i * 27}" font-size="17">${esc(line)}</text>`).join('')}<text x="300" y="711" font-size="13">${esc(dateText(dialogFind.foundAt))} · 実際に歩いた日の記録</text><text x="300" y="745" font-size="18" letter-spacing="5">まよいみち</text></g></svg>`;
  download(new Blob([svg], { type: 'image/svg+xml' }), `まよいみち-${item.name}.svg`);
  toast('この品のカードを保存しました。');
}

function showAbout(): void {
  showDialog(
    `<h2 id="dialog-title">使い方・設定</h2><div class="about-steps"><p><b>1</b> 地図からアイテムを選ぶ。</p><p><b>2</b> 「ルートを表示」で目的地へ歩く。</p><p><b>3</b> 到着を確認したら「拾う」。</p></div><button class="outline-button sound-button" data-action="sound">${icon(save.sound ? 'volume' : 'mute', 18)}発見の音：${save.sound ? 'オン' : 'オフ'}</button><button class="outline-button" data-action="mode">位置情報の設定</button><p class="privacy-note">建物の絵は異世界の演出です。「現実」で通常の地図に切り替えられます。地図に載っていない規制は反映されないため、入れない場所は目的地の詳細から非表示にしてください。<br><br>記録はこのブラウザ内に保存します。位置の履歴は保存しません。地図サービスには座標を送信します。</p><button class="text-button" data-action="phone-help">スマホでの使い方</button>`,
  );
}

document.addEventListener('click', (event) => {
  const target = (event.target as Element).closest<HTMLElement>('[data-action]');
  if (!target) return;
  event.preventDefault();
  const action = target.dataset.action;
  if (action?.startsWith('nav-')) {
    navigate(action.slice(4) as View);
    return;
  }
  switch (action) {
    case 'start':
      startWalk();
      break;
    case 'discover':
      showDiscovery();
      break;
    case 'keep':
      keepItem();
      break;
    case 'route-details':
      showRouteDetails();
      break;
    case 'hide-place':
      hidePlace();
      break;
    case 'reroute':
      reroute();
      break;
    case 'overview-route':
      closeDialog();
      if (session) world.frameDestination(session.place.coordinate);
      break;
    case 'stop-walk':
      session = null;
      world.setRoute(null);
      releaseScreen();
      closeDialog();
      selected = availablePlaces()[0];
      syncMap();
      renderQuest();
      break;
    case 'mode':
      showMode();
      break;
    case 'use-location':
      useLocation();
      break;
    case 'cancel-search':
      cancelSearch();
      renderQuest();
      break;
    case 'search-nearby':
      void searchNearby();
      break;
    case 'destinations':
      showDestinations();
      break;
    case 'choose-place':
      if (target.dataset.id) selectPlace(target.dataset.id);
      closeDialog();
      break;
    case 'zoom-in':
      world.zoom(1);
      break;
    case 'zoom-out':
      world.zoom(-1);
      break;
    case 'north':
      world.north();
      break;
    case 'center':
      world.center();
      break;
    case 'fantasy':
    case 'reality':
      fantasy = action === 'fantasy';
      world.setTheme(fantasy);
      document.querySelectorAll('.theme-switch button').forEach((e) => {
        const active = (e as HTMLElement).dataset.action === action;
        e.classList.toggle('active', active);
        e.setAttribute('aria-pressed', String(active));
      });
      break;
    case 'sound':
      save.sound = !save.sound;
      writeSave();
      updateSoundButton();
      if (save.sound) sound();
      break;
    case 'item-detail':
      if (target.dataset.id) showItem(target.dataset.id);
      break;
    case 'download-item':
      downloadItem();
      break;
    case 'export':
      exportData();
      break;
    case 'phone-help':
      showPhoneHelp();
      break;
    case 'about':
      showAbout();
      break;
    case 'close-dialog':
      closeDialog();
      break;
    case 'retry-map':
      world.retry();
      break;
  }
});

function updateSoundButton(): void {
  const button = $('.sound-button');
  if (!button) return;
  button.innerHTML = `${icon(save.sound ? 'volume' : 'mute')}発見の音：${save.sound ? 'オン' : 'オフ'}`;
  button.setAttribute('aria-label', `発見の音を${save.sound ? 'オフ' : 'オン'}にする`);
  button.setAttribute('aria-pressed', String(save.sound));
}
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) {
    const bounds = dialog.getBoundingClientRect();
    if (
      e.clientX < bounds.left ||
      e.clientX > bounds.right ||
      e.clientY < bounds.top ||
      e.clientY > bounds.bottom
    )
      closeDialog();
  }
});
dialog.addEventListener('close', () => {
  dialogFind = null;
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && session) {
    session.evidence.interrupted = true;
    session.evidence.arrivalSince = null;
    session.evidence.arrivalSamples = 0;
  }
  if (document.visibilityState === 'visible') {
    if (session) void keepScreenAwake();
    renderQuest();
  }
});
window.addEventListener('beforeunload', () => {
  stopLocation();
  searchController?.abort();
});
setInterval(() => {
  if (view === 'map') {
    if (dialog.open && dialog.querySelector('[data-action=keep]') && !pickupReady()) {
      closeDialog();
      toast('GPSの位置をもう一度確認しています。');
    }
    if (!dialog.open) renderQuest();
  }
}, 2000);
updateCounts();
updateSoundButton();
renderQuest();
syncMap();
if (loaded.error) {
  $('#storage-warning').classList.remove('hidden');
  toast('保存済みの記録を読み込めませんでした。元の保存データは変更していません。');
}
