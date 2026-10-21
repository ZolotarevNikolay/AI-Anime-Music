'use strict';

/**
 * Сквозная проверка «Моей волны» через Chrome DevTools Protocol.
 *
 * Проверяет запуск волны из аниме, воспроизведение, лайк/дизлайк/пропуск,
 * настройки, пополнение очереди и сохранение профиля вкусов.
 *
 * Запуск: node tools/test-wave-ui.js
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

const OPEN_WAVE = `(() => {
  const item = [...document.querySelectorAll('.nav-item')].find((n) => n.dataset.view === 'wave');
  return item ? 'found' : 'no-nav-item';
})()`;

const NAV_NO_AUTOPLAY = `(async () => {
  const item = [...document.querySelectorAll('.nav-item')].find((n) => n.dataset.view === 'wave');
  if (!item) return JSON.stringify({ error: 'нет пункта волны' });

  // Приводим плеер к чистому состоянию, чтобы проверить именно клик по меню.
  state.wave.requestId += 1;
  waveFillPromise = null;
  waveAdvancePromise = null;
  state.wave.active = false;
  state.wave.loading = false;
  state.wave.queue = [];
  state.wave.index = -1;
  state.wave.pool = [];
  state.wave.history = [];
  state.listenSession = null;
  state.queue = [];
  state.queueIndex = -1;
  state.currentId = null;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();

  item.click();
  await new Promise((r) => setTimeout(r, 600));

  return JSON.stringify({
    view: state.view,
    active: state.wave.active,
    queue: state.wave.queue.length,
    paused: audio.paused,
    intro: Boolean(document.getElementById('wave-start')),
    hero: Boolean(document.querySelector('.wave-hero'))
  });
})()`;

const LIKE = `(async () => {
  const current = currentTrack();
  if (!current) return JSON.stringify({ error: 'нет текущего трека' });
  const id = current.id;
  const eventsBefore = state.waveProfile.events || 0;

  // Приводим к состоянию «не в избранном», чтобы проверить именно добавление.
  if (isFavorite(current)) {
    document.querySelector('#wave-like')?.click();
    await new Promise((r) => setTimeout(r, 500));
  }

  const before = isFavorite(currentTrack());
  document.querySelector('#wave-like')?.click();
  await new Promise((r) => setTimeout(r, 800));
  const after = isFavorite(currentTrack());
  return JSON.stringify({
    id,
    before,
    after,
    inFavorites: state.animeFavorites.includes(id),
    eventsBefore,
    eventsAfter: state.waveProfile.events || 0,
    label: document.querySelector('#wave-like')?.textContent || ''
  });
})()`;

const SKIP = `(async () => {
  const before = currentTrack();
  if (!before) return JSON.stringify({ error: 'нет текущего трека' });
  document.querySelector('#wave-skip')?.click();
  await new Promise((r) => setTimeout(r, 1800));
  const after = currentTrack();
  return JSON.stringify({
    oldId: before.id,
    newId: after?.id || null,
    changed: Boolean(after && after.id !== before.id),
    active: state.wave.active,
    queue: state.wave.queue.length,
    title: document.querySelector('.wave-track-title')?.textContent || ''
  });
})()`;

const DISLIKE = `(async () => {
  const before = currentTrack();
  if (!before) return JSON.stringify({ error: 'нет текущего трека' });
  document.querySelector('#wave-dislike')?.click();
  await new Promise((r) => setTimeout(r, 2500));
  const after = currentTrack();
  return JSON.stringify({
    id: before.id,
    disliked: state.waveDislikes.includes(before.id),
    newId: after?.id || null,
    changed: Boolean(after && after.id !== before.id),
    active: state.wave.active,
    queue: state.wave.queue.length,
    label: document.querySelector('.wave-track-title')?.textContent || ''
  });
})()`;

const SETTINGS = `(async () => {
  const range = document.getElementById('wave-novelty');
  if (!range) return JSON.stringify({ error: 'нет ползунка новизны' });
  range.value = '70';
  range.dispatchEvent(new Event('input', { bubbles: true }));
  range.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));

  document.querySelector('.wave-mood[data-mood="calm"]')?.click();
  await new Promise((r) => setTimeout(r, 500));
  await persist();

  const saved = await window.player.getState();
  return JSON.stringify({
    novelty: state.waveSettings.novelty,
    mood: state.waveSettings.mood,
    savedNovelty: saved.waveSettings?.novelty,
    savedMood: saved.waveSettings?.mood,
    hasProfile: Boolean(saved.waveProfile) && typeof saved.waveProfile === 'object',
    hasHistory: Array.isArray(saved.listenHistory),
    hasDislikes: Array.isArray(saved.waveDislikes),
    activeMood: document.querySelector('.wave-mood.is-active')?.dataset.mood || null
  });
})()`;

const REFILL = `(async () => {
  const before = state.wave.queue.length;
  const filled = await refillWave({ force: true });
  await new Promise((r) => setTimeout(r, 300));
  return JSON.stringify({
    before,
    filled,
    after: state.wave.queue.length,
    active: state.wave.active,
    loading: state.wave.loading,
    error: state.wave.error || '',
    unique: new Set(state.wave.queue.map((track) => track.id)).size === state.wave.queue.length
  });
})()`;

const SYNC_REFILL = `(async () => {
  const before = state.wave.queue.length;
  const poolBefore = state.wave.pool.length;
  state.wave.index = state.wave.queue.length - 1;
  const filled = await refillWave();
  await new Promise((r) => setTimeout(r, 100));
  return JSON.stringify({
    before,
    poolBefore,
    filled,
    after: state.wave.queue.length,
    active: state.wave.active,
    loading: state.wave.loading,
    promiseCleared: waveFillPromise === null,
    error: state.wave.error || ''
  });
})()`;

const RESUME_NAV = `(async () => {
  const anime = [...document.querySelectorAll('.nav-item')].find((n) => n.dataset.view === 'anime');
  anime?.click();
  await new Promise((r) => setTimeout(r, 500));
  const wave = [...document.querySelectorAll('.nav-item')].find((n) => n.dataset.view === 'wave');
  wave?.click();
  await new Promise((r) => setTimeout(r, 700));
  return JSON.stringify({
    view: state.view,
    active: state.wave.active,
    hero: Boolean(document.querySelector('.wave-hero')),
    title: document.querySelector('.wave-track-title')?.textContent || ''
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

  console.log('\n=== Запуск волны ===');
  const opened = await evaluate(send, OPEN_WAVE);
  check('пункт меню «Моя волна» найден', opened === 'found', opened);

  const navOpen = await evaluate(send, NAV_NO_AUTOPLAY);
  check(
    'клик по меню не запускает музыку',
    navOpen.view === 'wave' && navOpen.active === false && navOpen.paused === true && navOpen.intro === true,
    JSON.stringify(navOpen)
  );

  // Из раздела «Аниме» открываем Naruto, чтобы у волны был seed.
  const start = await evaluate(send, `(async () => {
    const waitFor = async (probe, timeout = 15000) => {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        if (probe()) return true;
        await new Promise((r) => setTimeout(r, 200));
      }
      return false;
    };
    const animeNav = [...document.querySelectorAll('.nav-item')].find((n) => n.dataset.view === 'anime');
    animeNav?.click();
    await new Promise((r) => setTimeout(r, 300));
    const input = document.getElementById('anime-search-input');
    if (input) {
      input.value = 'Naruto';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await waitFor(() => document.querySelector('.anime-grid .card'), 16000);
    }
    document.querySelector('.anime-grid .card')?.click();
    await waitFor(() => document.getElementById('btn-anime-wave'), 18000);
    const waveButton = document.getElementById('btn-anime-wave');
    if (!waveButton) return JSON.stringify({ error: 'кнопка волны не появилась', view: state.view });
    waveButton.click();
    const a = document.getElementById('audio');
    const deadline = Date.now() + 9000;
    while (Date.now() < deadline && !a.error && a.currentTime <= 0.05) {
      await new Promise((r) => setTimeout(r, 250));
    }
    const title = document.querySelector('.wave-track-title')?.textContent || '';
    const current = currentTrack();
    return JSON.stringify({
      view: state.view,
      active: state.wave.active,
      loading: state.wave.loading,
      queue: state.wave.queue.length,
      history: state.wave.history.length,
      hero: Boolean(document.querySelector('.wave-hero')),
      next: document.querySelectorAll('.wave-next-item').length,
      nextHistory: document.querySelectorAll('.wave-history-row').length,
      title,
      currentId: current?.id || null,
      currentTitle: current?.title || '',
      matchesTitle: Boolean(current && title === current.title),
      src: (a.currentSrc || a.src || '').slice(0, 40),
      isRemote: (a.currentSrc || a.src || '').startsWith('media://remote/'),
      paused: a.paused,
      currentTime: Number(a.currentTime.toFixed(2)),
      mediaError: a.error ? a.error.code : null,
      uniqueQueue: new Set(state.wave.queue.map((track) => track.id)).size === state.wave.queue.length
    });
  })()`);

  check('волна открылась', start.view === 'wave' && start.hero === true, JSON.stringify(start));
  check('очередь волны собрана', start.queue > 0, `треков: ${start.queue}`);
  check('текущий трек играет', start.paused === false, `paused=${start.paused}`);
  check('источник — media://remote', start.isRemote === true, start.src);
  check('время идёт', start.currentTime > 0, `currentTime=${start.currentTime}`);
  check('нет ошибки воспроизведения', start.mediaError === null, `code=${start.mediaError}`);
  check('заголовок совпадает с текущим треком', start.matchesTitle === true, `${start.title} / ${start.currentTitle}`);
  check('в очереди нет дублей', start.uniqueQueue === true);
  check('блок «Дальше» заполнен', start.next > 0, `элементов: ${start.next}`);

  console.log('\n=== Лайк ===');
  const like = await evaluate(send, LIKE);
  check('трек не был в избранном до клика', like.before === false, JSON.stringify(like));
  check('трек попал в избранное', like.after === true && like.inFavorites === true, JSON.stringify(like));
  check('профиль вкусов получил сигнал', like.eventsAfter > like.eventsBefore, `${like.eventsBefore} → ${like.eventsAfter}`);

  console.log('\n=== Пропуск ===');
  const skip = await evaluate(send, SKIP);
  check('пропуск переключил трек', skip.changed === true, `${skip.oldId} → ${skip.newId}`);
  check('волна осталась активной', skip.active === true);
  check('заголовок обновился', Boolean(skip.title), skip.title);

  console.log('\n=== Дизлайк ===');
  const dislike = await evaluate(send, DISLIKE);
  check('трек добавлен в дизлайки', dislike.disliked === true, JSON.stringify(dislike));
  check('дизлайк сразу переключил трек', dislike.changed === true, `${dislike.id} → ${dislike.newId}`);
  check('волна продолжает играть', dislike.active === true && dislike.queue > 0, `queue=${dislike.queue}`);

  console.log('\n=== Настройки и сохранение ===');
  const settings = await evaluate(send, SETTINGS);
  check('ползунок новизны применился', Math.abs(settings.novelty - 0.7) < 0.001, JSON.stringify(settings));
  check('настроение применилось', settings.mood === 'calm' && settings.activeMood === 'calm', JSON.stringify(settings));
  check('настройки сохранены', Math.abs(settings.savedNovelty - 0.7) < 0.001 && settings.savedMood === 'calm', JSON.stringify(settings));
  check('профиль, история и дизлайки сохраняются', settings.hasProfile && settings.hasHistory && settings.hasDislikes, JSON.stringify(settings));

  console.log('\n=== Пополнение очереди ===');
  const refill = await evaluate(send, REFILL);
  check('волна догрузила треки', refill.filled > 0 && refill.after > refill.before, JSON.stringify(refill));
  check('после пополнения нет дублей', refill.unique === true);
  check('очередь не потеряла текущий трек', refill.active === true && !refill.error, JSON.stringify(refill));

  console.log('\n=== Быстрое пополнение без сети ===');
  const syncRefill = await evaluate(send, SYNC_REFILL);
  check('пополнение из готового пула сработало', syncRefill.filled > 0 && syncRefill.after > syncRefill.before, JSON.stringify(syncRefill));
  check('блокировка пополнения снята', syncRefill.promiseCleared === true && syncRefill.loading === false, JSON.stringify(syncRefill));

  console.log('\n=== Возврат в волну ===');
  const resume = await evaluate(send, RESUME_NAV);
  check('пункт меню возвращает в волну', resume.view === 'wave' && resume.active === true, JSON.stringify(resume));
  check('карточка волны отрисована', resume.hero === true && Boolean(resume.title), JSON.stringify(resume));

  console.log(`\nИтог: ${passed} ok, ${failed} fail\n`);
  ws.close();
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('ОШИБКА:', err.message);
  process.exit(1);
});
