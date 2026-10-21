'use strict';

/**
 * Проверяет запуск «Моей волны» с новыми треками без сети.
 * Подменяет источник каталога и использует короткий WAV data URL.
 *
 * Запуск: node tools/test-wave-start.js
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

const START = `(async () => {
  const makeWav = () => {
    const rate = 8000;
    const samples = 4000;
    const buffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(buffer);
    const text = (offset, value) => {
      for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };
    text(0, 'RIFF');
    view.setUint32(4, 36 + samples * 2, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, samples * 2, true);
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return 'data:audio/wav;base64,' + btoa(binary);
  };

  const wav = makeWav();
  const makeTrack = (i, known, prefix) => ({
    id: prefix + '-' + i,
    title: 'Start ' + i,
    artist: 'Artist ' + (i % 5),
    album: 'Synthetic',
    animeTitle: 'Anime ' + (i % 7),
    animeGenres: ['Action', 'Adventure'],
    animeYear: 2012 + (i % 10),
    animeScore: 75,
    themeType: i % 2 ? 'OP' : 'ED',
    duration: 1,
    streamUrl: wav,
    coverUrl: '',
    nsfw: false
  });

  const known = Array.from({ length: 12 }, (_, i) => makeTrack(i, true, 'known'));
  const fresh = Array.from({ length: 30 }, (_, i) => makeTrack(i, false, 'fresh'));

  const originalFetch = waveFetchCandidates;
  waveFetchCandidates = async () => fresh;

  state.wave.requestId += 1;
  waveFillPromise = null;
  waveAdvancePromise = null;
  state.wave.active = false;
  state.wave.queue = [];
  state.wave.index = -1;
  state.wave.pool = [];
  state.wave.history = [];
  state.wave.error = '';
  state.wave.catalogError = '';
  state.waveSettings.novelty = 0.9;
  state.listenHistory = [];
  state.waveDislikes = [];
  state.animeFavorites = known.map((track) => track.id);
  state.animeTrackStore = Object.fromEntries(known.map((track) => [track.id, track]));
  state.currentId = null;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();

  try {
    await startWave({ fresh: true });
    await new Promise((resolve) => setTimeout(resolve, 700));

    const current = state.wave.queue[0];
    const firstTen = state.wave.queue.slice(0, 10);
    const result = {
      active: state.wave.active,
      loading: state.wave.loading,
      queue: state.wave.queue.length,
      index: state.wave.index,
      currentId: current?.id || null,
      loadedId: state.currentId,
      srcIsWav: String(audio.src || '').startsWith('data:audio/wav'),
      firstKnown: current?._waveKnown,
      firstReason: current?._waveReason || '',
      knownInFirstTen: firstTen.filter((track) => track._waveKnown).length,
      freshInFirstTen: firstTen.filter((track) => !track._waveKnown).length,
      catalogError: state.wave.catalogError || '',
      error: state.wave.error || '',
      unique: new Set(state.wave.queue.map((track) => track.id)).size === state.wave.queue.length
    };
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    state.wave.active = false;
    state.wave.queue = [];
    state.wave.index = -1;
    state.wave.pool = [];
    return JSON.stringify(result);
  } finally {
    waveFetchCandidates = originalFetch;
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

  console.log('\n=== Запуск волны с новыми треками ===');
  const result = await evaluate(send, START);
  check('волна активна', result.active === true, JSON.stringify(result));
  check('очередь собрана', result.queue >= 8, `queue=${result.queue}`);
  check('первый трек — новый', result.firstKnown === false, `known=${result.firstKnown}`);
  check('в первой десятке 9 новых и 1 знакомый', result.freshInFirstTen === 9 && result.knownInFirstTen === 1, JSON.stringify(result));
  check('трек загружен в плеер', result.loadedId === result.currentId && result.srcIsWav === true, JSON.stringify({ current: result.currentId, loaded: result.loadedId, src: result.srcIsWav }));
  check('нет ошибки каталога', !result.catalogError && !result.error, JSON.stringify({ catalog: result.catalogError, error: result.error }));
  check('в очереди нет дублей', result.unique === true);

  console.log(`\nИтог: ${passed} ok, ${failed} fail\n`);
  ws.close();
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('ОШИБКА:', err.message);
  process.exit(1);
});
