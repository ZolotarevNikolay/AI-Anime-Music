'use strict';

/**
 * Проверяет, что волна берёт новые тайтлы из explore-каталога,
 * а не только из избранного/популярного.
 *
 * Запуск: node tools/test-wave-discover.js
 * Приложение должно быть запущено с --remote-debugging-port=9222.
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
  const page = pages.find((t) => /^file:\/\//i.test(t.url || '')) || pages[0];
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

const DISCOVER = `(async () => {
  const makeTarget = (prefix, i, source) => ({
    malId: 900000 + i + (prefix === 'rel' ? 0 : 1000),
    title: prefix + ' ' + i,
    genres: ['Action', 'Adventure', 'Fantasy'],
    year: 2000 + (i % 20),
    score: 75,
    rating: 10,
    _waveSource: source
  });
  const related = Array.from({ length: 12 }, (_, i) => makeTarget('rel', i, 'related'));
  const explore = Array.from({ length: 40 }, (_, i) => makeTarget('exp', i, 'explore'));
  const known = [{
    id: 'discover-known-1',
    title: 'Known',
    artist: 'Artist',
    animeTitle: 'Known Anime',
    malId: 777777,
    animeGenres: ['Action'],
    streamUrl: 'media://remote/known.mp3'
  }];

  const originalApi = api;
  let exploreCalls = 0;

  api = {
    ...originalApi,
    relatedAnime: async () => ({ related }),
    exploreAnime: async (options) => {
      exploreCalls += 1;
      return { ok: true, results: explore.slice(0, options.perPage || 30).map((target, i) => ({ ...target, malId: target.malId + exploreCalls * 10000 + i })) };
    },
    animeByGenres: async () => ({ results: [] }),
    popularAnime: async () => ({ results: [] })
  };

  state.wave.requestId += 1;
  state.wave.targets = [];
  state.wave.catalogError = '';
  state.animeFavorites = known.map((track) => track.id);
  state.animeTrackStore = Object.fromEntries(known.map((track) => [track.id, track]));
  state.listenHistory = [];
  state.anime.selected = null;
  state.anime.tracks = [];

  try {
    const chosen = await waveDiscoverTargets(null);
    const sources = chosen.reduce((counts, target) => {
      counts[target._waveSource] = (counts[target._waveSource] || 0) + 1;
      return counts;
    }, {});
    const result = {
      count: chosen.length,
      sources,
      exploreCalls,
      unique: new Set(chosen.map((target) => target.malId)).size === chosen.length,
      targetsStored: state.wave.targets.length,
      catalogError: state.wave.catalogError || '',
      allHaveMalId: chosen.every((target) => Boolean(target.malId)),
      chosen
    };
    state.wave.targets = [];
    state.wave.catalogError = '';
    return JSON.stringify(result);
  } finally {
    api = originalApi;
  }
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

  console.log('\n=== Поиск новых тайтлов ===');
  const result = await evaluate(send, DISCOVER);
  check('волна выбрала 8 новых тайтлов', result.count === 8, JSON.stringify(result.sources));
  check('использованы 2 explore-запроса', result.exploreCalls === 2, `calls=${result.exploreCalls}`);
  check('3 тайтла из рекомендаций и 5 из каталога', result.sources.related === 3 && result.sources.explore === 5, JSON.stringify(result.sources));
  check('в выборе нет дублей', result.unique === true);
  check('история целей пополнилась', result.targetsStored === 8, `stored=${result.targetsStored}`);
  check('нет ошибки каталога', !result.catalogError, result.catalogError);
  check('у всех целей есть MAL ID', result.allHaveMalId === true);

  console.log(`\nИтог: ${passed} ok, ${failed} fail\n`);
  ws.close();
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('ОШИБКА:', err.message);
  process.exit(1);
});
