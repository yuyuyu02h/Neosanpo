import './style.css';
import { WorldMap } from './map.ts';
import { nearbyPlaces } from './places.ts';
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
    <a class="brand" href="#" aria-label="まよいみち ホーム" data-action="nav-map"><span class="brand-mark">${sprig()}</span><span><strong>まよいみち</strong><small>MAYOIMICHI</small></span></a>
    <div class="side-intro"><span class="eyebrow">A LITTLE WALK, A STRANGE WORLD.</span><h1>いつもの道の、<br>向こうがわ。</h1><p>行き先は、すこし不思議。<br>持ち帰るのは、なんでもない宝物。</p></div>
    <nav class="main-nav" aria-label="メインメニュー">
      <button class="nav-button active" data-action="nav-map">${icon('compass')}<span>散歩する</span><span class="nav-dot"></span></button>
      <button class="nav-button" data-action="nav-collection">${icon('bag')}<span>拾ったもの</span><span class="collection-count">0</span></button>
      <button class="nav-button" data-action="nav-journal">${icon('book')}<span>散歩の記録</span></button>
    </nav>
    <div class="side-bottom"><div class="field-note"><span class="eyebrow">FIELD NOTE / 001</span><div class="scene">${landscape}</div><p>遠くへ行かなくても、<br>知らないものは落ちている。</p><span class="note-rule"></span></div><div class="side-footer"><span>道は現実。あとは、異世界。</span><button class="icon-button" data-action="about" aria-label="この散歩について">${icon('info', 18)}</button></div></div>
  </aside>
  <header class="mobile-header"><a href="#" class="brand" data-action="nav-map"><span class="brand-mark">${sprig()}</span><strong>まよいみち</strong></a><button class="icon-button" data-action="about" aria-label="この散歩について">${icon('info')}</button></header>
  <main class="main-area">
    <section id="map-view" class="map-view awaiting-location" aria-label="異世界の散歩地図">
      <div id="location-gate" class="location-gate"></div><div id="world-map"></div><div class="map-vignette"></div>
      <div class="map-heading"><div><span class="eyebrow">THE OTHER SIDE</span><h2 id="region-title">あなたの街の、向こうがわ</h2><span class="region-sub" id="region-sub">現在地を確認して、地図を開きます</span></div><div class="map-heading-actions"><button class="mode-pill" data-action="mode"><span></span><span id="mode-label">GPS確認待ち</span>${icon('arrow', 14)}</button><button class="icon-button sound-button" data-action="sound" aria-label="発見の音をオンにする">${icon('mute')}</button></div></div>
      <div class="map-toolbar"><button class="icon-button compass-button" data-action="north" aria-label="地図を北向きに戻す"><span>N</span>${icon('compass', 27)}</button><div class="toolbar-group"><button class="icon-button" data-action="zoom-in" aria-label="地図を拡大">${icon('plus')}</button><button class="icon-button" data-action="zoom-out" aria-label="地図を縮小">${icon('minus')}</button></div><button class="icon-button" data-action="center" aria-label="現在の位置を地図の中心へ">${icon('locate')}</button></div>
      <div class="theme-switch" role="group" aria-label="地図の表示"><button data-action="fantasy" class="active" aria-pressed="true">${icon('spark', 16)}異世界</button><button data-action="reality" aria-pressed="false">${icon('map', 16)}現実</button></div>
      <div id="map-status" class="map-status hidden" role="status"><span class="spinner"></span>向こうがわの地図をひらいています</div>
      <div class="map-bottom"><div class="map-caption"><span class="caption-line"></span>散歩の先に、なにかがある。<span class="caption-line"></span></div><div id="quest-card" class="quest-card"></div><div class="map-footnote"><span>${icon('walk', 13)}立ち止まって、見つけよう。</span><button data-action="destinations">ほかの気配を探す ${icon('arrow', 13)}</button></div></div>
      <div class="coordinate-note">あなたの一歩が、地図を進める。<br><span>YOUR REAL STEPS. ANOTHER WORLD.</span></div>
    </section>
    <section id="collection-view" class="content-view hidden" aria-labelledby="collection-title"></section>
    <section id="journal-view" class="content-view hidden" aria-labelledby="journal-title"></section>
  </main>
  <nav class="mobile-nav" aria-label="モバイルメニュー"><button data-action="nav-map" class="active">${icon('compass')}<span>散歩</span></button><button data-action="nav-collection">${icon('bag')}<span>拾ったもの <b class="collection-count">0</b></span></button><button data-action="nav-journal">${icon('book')}<span>記録</span></button></nav>
  <dialog id="dialog" aria-labelledby="dialog-title"><button class="dialog-close icon-button" data-action="close-dialog" aria-label="閉じる">${icon('close')}</button><div id="dialog-content"></div></dialog>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
  <div id="storage-warning" class="storage-warning hidden" role="alert">記録を自動保存できません。<button data-action="nav-journal">記録を書き出す</button></div>
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
    (p) => distance(position!, p.coordinate) >= WALK_RULES.minimumDestination,
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
      ? `${icon('info')}<span>地図が届きませんでした。通信を確認してください。</span><button data-action="retry-map">もう一度</button>`
      : '<span class="spinner"></span>向こうがわの地図をひらいています';
}

function syncMap(): void {
  world.setPlaces(
    session ? [session.place] : availablePlaces(),
    selected?.id ?? '',
    collectedPlaces(),
  );
  if (position) world.setPlayer(position);
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
    `<div class="location-intro"><span class="eyebrow">YOUR REAL WORLD, REIMAGINED</span><div class="gate-landscape">${landscape}</div><h1>あなたのいる場所が、<br>異世界の入口。</h1><p>スマホを持って、近くを歩こう。<br>実際にたどり着いた場所で、忘れものが見つかる。</p><button class="primary-button" data-action="use-location" ${locating ? 'disabled' : ''}>${locating ? '<span class="spinner"></span>現在地を確認しています' : `${icon('locate', 19)}現在地から、散歩を始める`}</button><p class="location-message" role="status">${esc(locationError || '位置情報を許可すると、いまいる場所の地図が開きます。')}</p><button class="text-button" data-action="phone-help">スマホでの開き方 ${icon('arrow', 15)}</button><p class="privacy-note">現在地を地図の表示と周辺検索に使います。<br>地図サービスに座標を送信します。移動の軌跡は保存しません。</p></div>`;
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
    card.innerHTML = `<div class="quest-loading"><span class="spinner"></span><div><h3>近くの気配を探しています。</h3><p>実際に歩いていける、周辺の場所を探しています。</p></div><button class="text-button" data-action="cancel-search">中止</button></div>`;
    return;
  }
  const place = session?.place ?? selected;
  if (!place) {
    card.innerHTML = `<div class="quest-empty">${icon('spark', 30)}<div><span class="eyebrow">TAKE YOUR TIME</span><h3>${searchError ? '気配を見失ってしまった。' : 'もう少し、歩いてみよう。'}</h3><p>${esc(searchError || '歩いて向かえる距離に、まだ見つかっていない場所を探します。')}</p></div></div><button class="primary-button" data-action="search-nearby">近くの気配を探す ${icon('arrow', 18)}</button>`;
    return;
  }
  const meters = distance(position, place.coordinate);
  const state = session
    ? pickupState(session.evidence, currentFix, place.coordinate, Date.now())
    : null;
  const ready = state === 'ready';
  const fresh = accurateFix(currentFix, Date.now());
  const action = !session ? 'start' : ready ? 'discover' : 'center';
  const button = !session
    ? 'ここへ、歩き始める'
    : ready
      ? '足もとを見てみる'
      : state === 'settling'
        ? 'ここで、ひと休み'
        : '現在地を見渡す';
  const messages = {
    position: 'GPSを確認しています。空の見える場所でお待ちください。',
    walking: 'スマホを持って歩いてください。移動をGPSで確認しています。',
    far: '現実の道を歩いて、気配の近くへ。',
    settling: '近くに着きました。立ち止まって、位置が落ち着くのを待とう。',
    ready: 'ここまで歩いたあなたに、小さな忘れもの。',
  };
  const note =
    locationError ||
    (state ? messages[state] : '距離は直線の目安です。現実の道に沿って歩いてください。');
  card.innerHTML = `<div class="quest-topline"><span class="eyebrow"><span class="tiny-dot"></span>${session ? (ready ? 'SOMETHING AT YOUR FEET' : 'YOUR STEPS, YOUR JOURNEY') : 'YOUR NEXT LITTLE DETOUR'}</span><span class="quest-number">${fresh ? 'GPS接続中' : 'GPS確認待ち'}</span></div><div class="quest-main"><div class="quest-seal">${icon(ready ? 'spark' : 'pin', 28)}<span class="seal-spark">✧</span></div><div class="quest-copy"><h3>${ready ? 'なにか、落ちている。' : esc(place.name)}</h3><p>${esc(ready ? '立ち止まって、そっと見てみよう。' : place.hint)}</p></div><div class="quest-distance"><strong>${Math.round(meters)}</strong><span>m <small>直線</small></span></div></div><div class="quest-actions"><span class="quest-place">${icon('pin', 13)}${esc(place.realName)}</span><button class="primary-button" data-action="${action}" ${!session && !fresh ? 'disabled' : ''}>${button}${icon(ready ? 'spark' : 'arrow', 18)}</button></div><div class="walk-status"><span>${esc(note)}${session ? `<br>確認できた歩行：${formatDistance(session.evidence.totalDistance)}` : ''}</span>${session ? '<button data-action="stop-walk">散歩をやめる</button>' : ''}</div>`;
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
    `<div class="page-heading"><span class="eyebrow">A ROOM FOR ORDINARY TREASURES</span><h2 id="collection-title">なんでもない、宝物。</h2><p>役には立たなくても。<br class="mobile-break">拾った日のことは、思い出せる。</p><span class="page-count">${finds.length}<small>個の忘れもの</small></span></div>${
      finds.length
        ? `<div class="item-grid">${finds
            .map((find, i) => {
              const item = itemById(find.itemId);
              return `<button class="item-card" data-action="item-detail" data-id="${esc(find.id)}"><div class="item-picture" style="--item-color:${item.color}"><span class="item-number">NO. ${String(finds.length - i).padStart(3, '0')}</span>${itemArt(item.art)}</div><div class="item-card-copy"><h3>${item.name}</h3><p>${item.subtitle}</p><span>${dateText(find.foundAt)} ${icon('arrow', 15)}</span></div></button>`;
            })
            .join('')}</div><p class="shelf-note">持っていることに、理由はいらない。</p>`
        : `<div class="empty-state"><div class="empty-illustration">${itemArt('key')}</div><span class="eyebrow">NOTHING YET. THAT'S A START.</span><h3>ポケットは、まだ空っぽ。</h3><p>何が落ちているかは、行ってからのお楽しみ。<br>小さな寄り道に、出かけてみよう。</p><button class="primary-button" data-action="nav-map">最初の散歩へ ${icon('arrow', 18)}</button></div>`
    }`;
}

function renderJournal(): void {
  const realWalks = save.walks.filter((w) => w.mode === 'live');
  const total = realWalks.reduce((sum, walk) => sum + walk.distance, 0);
  $('#journal-view').innerHTML =
    `<div class="page-heading"><span class="eyebrow">SMALL STEPS, QUIET STORIES</span><h2 id="journal-title">歩いた日のこと。</h2><p>いつもの一日から、<br class="mobile-break">すこしだけ、はみ出した記録。</p><button class="outline-button export-button" data-action="export">${icon('download', 16)}記録を書き出す</button></div><div class="journal-stats"><div><span>近所を歩いた距離</span><strong>${formatDistance(total)}</strong></div><div><span>近所の散歩</span><strong>${realWalks.length}<small>回</small></strong></div><div><span>持ち帰った品</span><strong>${save.finds.length}<small>個</small></strong></div></div>${
      save.walks.length
        ? `<div class="journal-list">${[...save.walks]
            .reverse()
            .map((walk) => {
              const find = save.finds.find((f) => f.id === walk.findId)!;
              const item = itemById(find.itemId);
              return `<button class="journal-entry" data-action="item-detail" data-id="${esc(find.id)}"><div class="journal-art" style="background:${item.color}">${itemArt(item.art)}</div><div><span class="entry-date">${dateText(walk.endedAt)}</span><h3>${item.name}を拾った日</h3><p>${esc(find.placeName)}</p></div><span class="entry-distance">${formatDistance(walk.distance)}${icon('arrow', 17)}</span></button>`;
            })
            .join('')}</div>`
        : `<div class="journal-empty">${landscape}<h3>最初の一歩を、待っています。</h3><p>散歩で何かを拾うと、ここに記録が残ります。</p><button class="text-button" data-action="nav-map">散歩に出かける ${icon('arrow', 16)}</button></div>`
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
    `<span class="eyebrow">CONNECTED TO YOUR FOOTSTEPS</span><h2 id="dialog-title">いまいる場所から、歩く。</h2><p class="dialog-lead">現在地の道路はそのままに、街の姿が異世界へ変わります。人物はスマートフォンの実際の移動に合わせて進みます。</p><div class="gps-detail">${accurateFix(currentFix, Date.now()) ? `GPSの位置精度：約${Math.round(currentFix!.accuracy)}m` : '現在地の確認を待っています。'}</div><button class="primary-button" data-action="use-location">${icon('locate', 18)}現在地を再確認</button><p class="privacy-note">位置情報の許可と、端末の「正確な位置情報」をオンにしてください。散歩中はこの画面を開いたままにします。GPSの移動・精度・到着を確認できたときだけ、品を拾えます。</p><button class="text-button" data-action="phone-help">スマホでの開き方 ${icon('arrow', 15)}</button>`,
  );
}

function showPhoneHelp(): void {
  showDialog(
    `<span class="eyebrow">TAKE IT OUTSIDE</span><h2 id="dialog-title">スマホで、外へ。</h2><p class="dialog-lead">スマートフォンのSafariまたはChromeで、HTTPSのアプリURLを開きます。</p><div class="about-steps"><p><b>01</b> 「現在地から、散歩を始める」を押す。</p><p><b>02</b> 位置情報と、正確な位置の利用を許可する。</p><p><b>03</b> 目的地を選び、画面を開いたまま歩く。</p></div><p class="privacy-note">PCに表示された localhost / 127.0.0.1 は、そのPC専用のURLです。スマホではHTTPSで配信されたURLを使います。ホーム画面に追加して使うこともできます。</p><button class="primary-button" data-action="close-dialog">わかりました ${icon('check', 18)}</button>`,
  );
}

function showDestinations(): void {
  const available = availablePlaces();
  showDialog(
    `<span class="eyebrow">LITTLE SIGNS NEARBY</span><h2 id="dialog-title">あっちにも、気配。</h2><p class="dialog-lead">何があるかは、まだわからない。</p><div class="destination-list">${available.map((p) => `<button data-action="choose-place" data-id="${esc(p.id)}">${icon('spark', 23)}<span><strong>${esc(p.name)}</strong><small>${esc(p.realName)}</small></span><span class="destination-distance">${formatDistance(distance(position!, p.coordinate))}${icon('arrow', 14)}</span></button>`).join('') || '<p>このあたりの落とし物は、ひとめぐりしました。</p>'}</div><button class="outline-button" data-action="search-nearby">もう一度、近くを探す</button><p class="privacy-note">距離は現在の位置からの直線距離です。</p>`,
  );
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
    toast('歩いて向かえる距離の場所を、もう一度選んでください。');
    return;
  }
  session = {
    place: selected,
    startedAt: new Date().toISOString(),
    evidence: startEvidence(currentFix),
  };
  void keepScreenAwake();
  syncMap();
  renderQuest();
  world.frameDestination(selected.coordinate);
  toast('いってらっしゃい。あなたが歩くと、地図の中のあなたも進みます。');
}

function showDiscovery(): void {
  if (!session || !pickupReady()) {
    toast('目的地の近くで、現在地が確認できると拾えます。');
    return;
  }
  const item = itemById(session.place.itemId);
  showDialog(
    `<div class="discovery-art" style="--item-color:${item.color}"><span class="eyebrow">WELL, LOOK AT THAT.</span>${itemArt(item.art)}<span class="discovery-spark a">✧</span><span class="discovery-spark b">✧</span></div><div class="discovery-copy"><span class="eyebrow">なんでもない、宝物を見つけた。</span><h2 id="dialog-title">${item.name}</h2><p class="item-subtitle">${item.subtitle}</p><p class="item-description">${item.description}</p><p class="item-note">${item.note}</p><button class="primary-button" data-action="keep">ポケットにしまう ${icon('bag', 18)}</button></div>`,
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
  releaseScreen();
  writeSave();
  selected = availablePlaces()[0];
  syncMap();
  renderQuest();
  closeDialog();
  sound();
  toast(`${itemById(find.itemId).name}を持ち帰りました。`);
  if (view === 'collection') renderCollection();
}

function showItem(id: string): void {
  const find = save.finds.find((f) => f.id === id);
  if (!find) return;
  dialogFind = find;
  const item = itemById(find.itemId);
  showDialog(
    `<div class="discovery-art" style="--item-color:${item.color}"><span class="eyebrow">A SMALL THING YOU BROUGHT HOME</span>${itemArt(item.art)}</div><div class="discovery-copy"><span class="eyebrow">${dateText(find.foundAt)}</span><h2 id="dialog-title">${item.name}</h2><p class="item-subtitle">${item.subtitle}</p><p class="item-description">${item.description}</p><p class="item-note">${item.note}</p><div class="found-location">${icon('pin', 15)}${esc(find.placeName)}</div><button class="outline-button" data-action="download-item">${icon('download', 16)}この品のカードを保存</button></div>`,
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
    places = found;
    selected = availablePlaces()[0];
    if (found.length === 0)
      searchError =
        '近くに立ち寄れる候補が見つかりませんでした。少し場所を変えてから、もう一度探してください。';
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
    `<span class="eyebrow">WELCOME TO MAYOIMICHI</span><h2 id="dialog-title">道は現実。<br>あとは、異世界。</h2><div class="about-scene">${landscape}</div><p class="dialog-lead">少しだけ外へ出て、<br>誰かの忘れものを持って帰る。</p><div class="about-steps"><p><b>01</b> 地図の「気配」を目的地に選ぶ。</p><p><b>02</b> 現実の道を、自分のペースで歩く。</p><p><b>03</b> 近くに着いたら立ち止まり、拾う。</p></div><p class="privacy-note">異世界の建物と呼び名は演出です。「現実」ボタンで元の地図を確認できます。距離は直線の目安で、徒歩ルート案内は行いません。<br><br>記録はこのブラウザだけに保存されます。ブラウザのデータを消すと記録も消えるため、「散歩の記録」から書き出せます。実際の位置情報を使う際は、地図配信・周辺検索サービスに座標が送信されます。</p><button class="primary-button" data-action="close-dialog">寄り道へ、どうぞ ${icon('arrow', 18)}</button>`,
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
    case 'stop-walk':
      session = null;
      releaseScreen();
      selected = availablePlaces()[0];
      syncMap();
      renderQuest();
      toast('ひと休み。目的地は、ここで待っています。');
      break;
    case 'mode':
      showMode();
      break;
    case 'use-location':
      useLocation();
      break;
    case 'cancel-search': {
      const wasLocating = locating;
      cancelSearch();
      if (wasLocating) stopLocation();
      if (position && !places.length)
        searchError = '周辺検索を中止しました。もう一度探すこともできます。';
      renderQuest();
      break;
    }
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
      toast(save.sound ? '発見の音をオンにしました。' : '発見の音をオフにしました。');
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
  button.innerHTML = icon(save.sound ? 'volume' : 'mute');
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
