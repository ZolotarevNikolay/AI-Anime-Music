'use strict';

/**
 * Синтетическая проверка выбора треков «Моей волны» без сети.
 *
 * Запуск: node tools/test-wave-sim.js
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

const SIM = `(async () => {
  const makeTrack = (i, known) => ({
    id: 'sim-' + (known ? 'k' : 'n') + '-' + i,
    title: 'Sim ' + i,
    artist: 'Artist ' + (i % 7),
    animeTitle: 'Anime ' + (i % 11),
    animeGenres: ['Action', 'Adventure', 'Fantasy'],
    animeYear: 2010 + (i % 15),
    animeScore: 70 + (i % 20),
    themeType: i % 2 ? 'OP' : 'ED',
    streamUrl: 'media://remote/sim-' + i + '.mp3',
    nsfw: false
  });

  const known = Array.from({ length: 30 }, (_, i) => makeTrack(i, true));
  const fresh = Array.from({ length: 150 }, (_, i) => makeTrack(i, false));

  state.wave.requestId += 1;
  waveFillPromise = null;
  state.wave.active = true;
  state.wave.loading = false;
  state.wave.error = '';
  state.wave.catalogError = '';
  state.wave.queue = [];
  state.wave.index = -1;
  state.wave.history = [];
  state.wave.targets = [];
  state.wave.pool = [...fresh, ...known];
  state.waveSettings.novelty = 0.9;
  state.listenHistory = [];
  state.waveDislikes = [];
  state.animeFavorites = known.map((track) => track.id);
  state.animeTrackStore = Object.fromEntries(known.map((track) => [track.id, track]));

  const batches = [];
  let duplicate = false;
  for (let round = 0; round < 12; round++) {
    const picks = wavePickTracks(10);
    const ids = picks.map((track) => track.id);
    batches.push({
      count: picks.length,
      known: picks.filter((track) => track._waveKnown).length,
      fresh: picks.filter((track) => !track._waveKnown).length,
      unique: new Set(ids).size === ids.length,
      reason: Boolean(picks[0]?._waveReason)
    });
    if (state.wave.queue.some((track) => ids.includes(track.id))) duplicate = true;
    state.wave.queue.push(...picks);
  }

  const first = batches[0];
  const allTen = batches.every((batch) => batch.count === 10);
  const allUnique = batches.every((batch) => batch.unique);
  const nineFresh = batches.every((batch) => batch.fresh === 9 && batch.known === 1);
  const reasons = batches.every((batch) => batch.reason);
  const simulatedQueue = state.wave.queue.slice();
  const simulatedTotal = simulatedQueue.length;
  const noDuplicates = !duplicate
    && new Set(simulatedQueue.map((track) => track.id)).size === simulatedQueue.length;

  // Пополнение из уже готового пула не должно ходить в сеть.
  state.wave.queue = [];
  state.wave.index = -1;
  state.wave.history = [];
  state.wave.pool = [...fresh, ...known];
  state.wave.loading = false;
  state.view = 'anime';
  const refilled = await refillWave({ force: false });

  // Аварийный запас: только знакомые треки, когда каталог пуст.
  state.wave.queue = [];
  state.wave.index = -1;
  state.wave.pool = [];
  const fallback = waveFamiliarFallback(null, null, 8);

  const result = {
    first,
    allTen,
    allUnique,
    nineFresh,
    reasons,
    noDuplicates,
    total: simulatedTotal,
    refilled,
    fallback,
    fallbackUnique: new Set(state.wave.queue.map((track) => track.id)).size === state.wave.queue.length,
    fallbackKnown: state.wave.queue.every((track) => track._waveKnown)
  };

  return JSON.stringify(result);
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

  console.log('\n=== Синтетическая волна ===');
  const result = await evaluate(send, SIM);
  check('каждая партия содержит 10 треков', result.allTen, JSON.stringify(result.first));
  check('внутри партий нет дублей', result.allUnique);
  check('при 90% новизны — 9 новых и 1 знакомый', result.nineFresh, JSON.stringify(result.first));
  check('у треков есть причина выбора', result.reasons);
  check('12 пополнений (120 треков) без повторов', result.noDuplicates, `total=${result.total}`);
  check('refillWave добавляет треки из готового пула', result.refilled > 0, `refilled=${result.refilled}`);
  check('аварийный запас играет знакомое', result.fallback > 0 && result.fallbackKnown, JSON.stringify({ fallback: result.fallback, known: result.fallbackKnown }));
  check('в аварийном запасе нет дублей', result.fallbackUnique);

  console.log(`\nИтог: ${passed} ok, ${failed} fail\n`);
  ws.close();
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('ОШИБКА:', err.message);
  process.exit(1);
});
