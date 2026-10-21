'use strict';

/**
 * Сквозная проверка раздела «Аниме» через Chrome DevTools Protocol.
 *
 * Проверяет весь путь: поиск аниме → список опенингов → воспроизведение
 * удалённого трека в общем плеере → избранное → видео.
 *
 * Запуск: node tools/test-anime-ui.js
 */

const PORT = process.env.CDP_PORT || 9222;

let passed = 0;
let failed = 0;

function check(name, condition, extra = '') {
  if (condition) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

async function getTarget() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const targets = await res.json();
  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  // При запуске с --dev первым в списке идёт DevTools, а не окно приложения.
  const page = pages.find((t) => /^file:\/\//i.test(t.url || ''))
    || pages.find((t) => t.title === 'Музыка')
    || pages[0];
  if (!page) throw new Error('Страница приложения не найдена');
  return page;
}

function cdp(ws) {
  let id = 0;
  const pending = new Map();

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });

  return (method, params = {}) => new Promise((resolve, reject) => {
    const messageId = ++id;
    pending.set(messageId, { resolve, reject });
    ws.send(JSON.stringify({ id: messageId, method, params }));
  });
}

/** Выполняет выражение в окне приложения и возвращает распарсенный JSON. */
async function evaluate(send, expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || 'Ошибка выполнения');
  }
  const value = result.result.value;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

const OPEN_ANIME = `(() => {
  const item = [...document.querySelectorAll('.nav-item')].find((n) => n.dataset.view === 'anime');
  if (!item) return 'no-nav-item';
  item.click();
  return 'clicked';
})()`;

const SEARCH = `(async () => {
  const waitFor = async (probe, timeout = 20000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (probe()) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  };
  const input = document.getElementById('anime-search-input');
  if (!input) return JSON.stringify({ error: 'нет поля поиска аниме' });
  const before = animeRequestId;
  input.value = 'Naruto';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => animeRequestId > before);
  await waitFor(() => !state.anime.loading && state.anime.query === 'Naruto' && document.querySelectorAll('.anime-grid .card').length > 0);
  const cards = document.querySelectorAll('.anime-grid .card');
  return JSON.stringify({
    cards: cards.length,
    firstTitle: cards[0] ? cards[0].querySelector('.card-title').textContent : null,
    sources: document.getElementById('anime-sources')?.textContent || ''
  });
})()`;

const OPEN_FIRST = `(async () => {
  const waitFor = async (probe, timeout = 25000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (probe()) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  };
  const card = document.querySelector('.anime-grid .card');
  if (!card) return JSON.stringify({ error: 'нет карточек' });
  card.click();
  await waitFor(() => document.querySelectorAll('.anime-tracks .track-row').length > 0);
  const rows = document.querySelectorAll('.anime-tracks .track-row');
  return JSON.stringify({
    rows: rows.length,
    title: document.querySelector('.anime-title')?.textContent || '',
    badge: rows[0] ? rows[0].querySelector('.theme-badge')?.textContent : null,
    song: rows[0] ? rows[0].querySelector('.tr-title')?.textContent : null,
    artist: rows[0] ? rows[0].querySelector('.tr-artist')?.textContent : null,
    hasVideoBtn: Boolean(rows[0]?.querySelector('.video-btn'))
  });
})()`;

const PLAY = `(async () => {
  const waitFor = async (probe, timeout = 12000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (probe()) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  };
  const row = document.querySelector('.anime-tracks .track-row');
  if (!row) return JSON.stringify({ error: 'нет строк' });
  row.click();
  const a = document.getElementById('audio');
  await waitFor(() => a.error || a.currentTime > 0.05);
  return JSON.stringify({
    title: document.getElementById('np-title').textContent,
    artist: document.getElementById('np-artist').textContent,
    src: (a.currentSrc || a.src || '').slice(0, 40),
    isRemote: (a.currentSrc || a.src || '').startsWith('media://remote/'),
    paused: a.paused,
    currentTime: Number(a.currentTime.toFixed(2)),
    duration: Number.isFinite(a.duration) ? Number(a.duration.toFixed(2)) : null,
    readyState: a.readyState,
    mediaError: a.error ? a.error.code : null
  });
})()`;

const FAVORITE = `(async () => {
  const like = document.querySelector('.anime-tracks .track-row .like-btn');
  if (!like) return JSON.stringify({ error: 'нет кнопки' });

  // Приводим состояние к известному: сначала убираем из избранного, если оно там есть.
  if (like.textContent === '♥') {
    like.click();
    await new Promise((r) => setTimeout(r, 600));
  }

  const before = document.querySelector('.anime-tracks .track-row .like-btn').textContent;
  const track = currentTrack();
  const likedBefore = isFavorite(track);

  document.querySelector('.anime-tracks .track-row .like-btn').click();
  await new Promise((r) => setTimeout(r, 900));

  const after = document.querySelector('.anime-tracks .track-row .like-btn').textContent;
  const npLike = document.getElementById('np-like');
  return JSON.stringify({
    before,
    after,
    likedBefore,
    likedAfter: isFavorite(currentTrack()),
    npLiked: npLike.classList.contains('is-liked'),
    inList: state.animeFavorites.length
  });
})()`;

const VIDEO = `(async () => {
  const waitFor = async (probe, timeout = 12000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (probe()) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  };
  const btn = document.querySelector('.anime-tracks .track-row .video-btn');
  if (!btn) return JSON.stringify({ error: 'нет кнопки видео' });

  const a = document.getElementById('audio');
  const v = document.getElementById('video-player');
  const overlay = document.getElementById('video-overlay');
  const before = {
    time: Number.isFinite(a.currentTime) ? a.currentTime : 0,
    paused: a.paused,
    id: state.currentId
  };

  btn.click();
  await waitFor(() => !overlay.hidden && v.readyState >= 1, 15000);
  await new Promise((r) => setTimeout(r, 600));

  const opened = !overlay.hidden;
  const pausedWhileOpen = a.paused;
  const videoStart = Number(v.currentTime.toFixed(2));

  document.getElementById('video-close').click();
  await waitFor(() => overlay.hidden && !a.paused, 6000);
  await new Promise((r) => setTimeout(r, 300));

  return JSON.stringify({
    opened,
    closed: overlay.hidden,
    beforeTime: Number(before.time.toFixed(2)),
    beforePaused: before.paused,
    pausedWhileOpen,
    videoStart,
    afterTime: Number(a.currentTime.toFixed(2)),
    afterPaused: a.paused,
    synced: videoStart >= Math.max(0, before.time - 1),
    resumed: !a.paused && a.currentTime >= Math.max(0, before.time - 0.5),
    src: (v.currentSrc || v.src || '').slice(0, 40),
    isRemote: (v.currentSrc || v.src || '').startsWith('media://remote/'),
    readyState: v.readyState
  });
})()`;

const FAVORITES_VIEW = `(async () => {
  const item = [...document.querySelectorAll('.nav-item')].find((n) => n.dataset.view === 'favorites');
  item.click();
  await new Promise((r) => setTimeout(r, 900));
  const rows = document.querySelectorAll('.track-row');
  return JSON.stringify({
    rows: rows.length,
    titles: [...rows].slice(0, 3).map((r) => r.querySelector('.tr-title')?.textContent)
  });
})()`;

(async () => {
  const target = await getTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  const send = cdp(ws);
  await send('Runtime.enable');

  console.log('\n=== Раздел «Аниме» ===');
  const opened = await evaluate(send, OPEN_ANIME);
  check('пункт меню «Аниме» найден и нажат', opened === 'clicked', opened);

  console.log('\n=== Поиск аниме ===');
  const search = await evaluate(send, SEARCH);
  check('поиск вернул карточки', search.cards > 0, `карточек: ${search.cards}`);
  check('первая карточка — Naruto', /naruto/i.test(search.firstTitle || ''), search.firstTitle);
  check('источники показаны', Boolean(search.sources), search.sources);

  console.log('\n=== Список опенингов ===');
  const details = await evaluate(send, OPEN_FIRST);
  check('аниме открылось', Boolean(details.title), details.title);
  check('треки выведены', details.rows > 0, `строк: ${details.rows}`);
  check('есть название песни', Boolean(details.song), details.song);
  check('есть исполнитель', Boolean(details.artist), details.artist);
  check('бейдж типа проставлен', ['OP', 'ED', 'IN'].includes(details.badge), details.badge);
  check('кнопка видео есть', details.hasVideoBtn === true);

  console.log('\n=== Воспроизведение ===');
  const play = await evaluate(send, PLAY);
  check('трек играет (не на паузе)', play.paused === false, JSON.stringify(play));
  check('источник — удалённый media://remote', play.isRemote === true, play.src);
  check('время идёт', play.currentTime > 0, `currentTime=${play.currentTime}`);
  check('длительность известна', play.duration > 0, `duration=${play.duration}`);
  check('нет ошибки воспроизведения', play.mediaError === null, `code=${play.mediaError}`);

  console.log('\n=== Избранное ===');
  const fav = await evaluate(send, FAVORITE);
  check('трек не был в избранном до клика', fav.likedBefore === false, `likedBefore=${fav.likedBefore}`);
  check('кнопка изменила состояние', fav.before !== fav.after, `${fav.before} → ${fav.after}`);
  check('трек попал в избранное', fav.likedAfter === true, `likedAfter=${fav.likedAfter}`);
  check('мини-плеер показывает сердечко', fav.npLiked === true);

  console.log('\n=== Видео опенинга ===');
  const video = await evaluate(send, VIDEO);
  check('окно видео открылось', video.opened === true);
  check('видео грузится через media://remote', video.isRemote === true, video.src);
  check('во время видео музыка на паузе', video.pausedWhileOpen === true, JSON.stringify(video));
  check('видео начинается с текущей позиции', video.synced === true, JSON.stringify(video));
  check('после закрытия музыка продолжается', video.resumed === true, JSON.stringify(video));
  check('позиция трека не сброшена', video.afterTime >= Math.max(0, video.beforeTime - 0.5), JSON.stringify(video));
  check('окно видео закрывается', video.closed === true);

  console.log('\n=== Раздел «Моё любимое» ===');
  const favView = await evaluate(send, FAVORITES_VIEW);
  check('избранный трек виден в разделе', favView.rows > 0, `строк: ${favView.rows}`);

  console.log(`\nИтог: ${passed} ok, ${failed} fail\n`);
  ws.close();
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('ОШИБКА:', err.message);
  process.exit(1);
});
