'use strict';

/* ==========================================================
   Плеер опенингов и эндингов — логика интерфейса
   ========================================================== */

const api = window.player;

const audio = document.getElementById('audio');

/** Состояние основного плеера до открытия видео: чтобы вернуть позицию, а не начинать трек заново. */
let videoResume = null;

const el = {
  nav: document.getElementById('nav'),
  playlistNav: document.getElementById('playlist-nav'),
  content: document.getElementById('content'),
  view: document.getElementById('view'),
  npCover: document.getElementById('np-cover'),
  npTitle: document.getElementById('np-title'),
  npArtist: document.getElementById('np-artist'),
  npLike: document.getElementById('np-like'),
  btnPlay: document.getElementById('btn-play'),
  btnPrev: document.getElementById('btn-prev'),
  btnNext: document.getElementById('btn-next'),
  btnShuffle: document.getElementById('btn-shuffle'),
  btnRepeat: document.getElementById('btn-repeat'),
  btnMute: document.getElementById('btn-mute'),
  btnBack: document.getElementById('btn-back'),
  btnForward: document.getElementById('btn-forward'),
  btnQueue: document.getElementById('btn-queue'),
  btnNewPlaylist: document.getElementById('btn-new-playlist'),
  seek: document.getElementById('seek'),
  volume: document.getElementById('volume'),
  timeCurrent: document.getElementById('time-current'),
  timeTotal: document.getElementById('time-total'),
  modalOverlay: document.getElementById('modal-overlay'),
  modal: document.getElementById('modal'),
  modalTitle: document.getElementById('modal-title'),
  modalInput: document.getElementById('modal-input'),
  modalOk: document.getElementById('modal-ok'),
  modalCancel: document.getElementById('modal-cancel'),
  toast: document.getElementById('toast'),
  videoOverlay: document.getElementById('video-overlay'),
  videoPlayer: document.getElementById('video-player'),
  videoTitle: document.getElementById('video-title'),
  videoClose: document.getElementById('video-close'),
};

/* ================== Состояние ================== */

const state = {
  playlists: [],
  // Удалённые треки: идентификаторы отдельно, сами треки — в хранилище,
  // чтобы избранное и плейлисты переживали перезапуск приложения.
  animeFavorites: [],
  animeTrackStore: {},
  view: 'anime',
  activePlaylistId: null,
  currentId: null,
  queue: [],
  queueIndex: -1,
  isPlaying: false,
  shuffle: false,
  repeat: 'off', // off | all | one
  volume: 0.8,
  lastVolume: 0.8,
  history: ['anime'],
  historyIndex: 0,

  // «Моя волна»: локальный профиль вкусов и обратная связь.
  waveProfile: { genres: {}, artists: {}, anime: {}, eras: {}, types: {}, events: 0, updatedAt: 0 },
  listenHistory: [],
  waveDislikes: [],
  waveSettings: { novelty: 0.4, mood: 'auto' },
  listenSession: null,
  wave: {
    active: false,
    loading: false,
    error: '',
    queue: [],
    index: -1,
    pool: [],
    targets: [],
    history: [],
    requestId: 0,
  },

  // Раздел «Аниме»: поиск, выбранное аниме и его опенинги/эндинги.
  anime: {
    query: '',
    results: [],
    sources: {},
    loading: false,
    error: '',
    selected: null,
    tracks: [],
    tracksLoading: false,
    tracksError: '',
  },
};

const coverCache = new Map();

/* ================== SVG-иконки ================== */

const ICONS = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.5 4.2v15.6L19.5 12z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1.3"/><rect x="14" y="4.5" width="4" height="15" rx="1.3"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.2s-7.3-4.5-7.3-9.5A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.3 3.1c0 5-7.3 9.5-7.3 9.5Z"/></svg>',
  heartFilled: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.2s-7.3-4.5-7.3-9.5A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.3 3.1c0 5-7.3 9.5-7.3 9.5Z"/></svg>',
  volume: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  muted: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 3 20 6.5 16.5 10"/><path d="M4 12V10a3.5 3.5 0 0 1 3.5-3.5H20"/><path d="M7.5 21 4 17.5 7.5 14"/><path d="M20 12v2a3.5 3.5 0 0 1-3.5 3.5H4"/></svg>',
  repeatOne: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 3 20 6.5 16.5 10"/><path d="M4 12V10a3.5 3.5 0 0 1 3.5-3.5H20"/><path d="M7.5 21 4 17.5 7.5 14"/><path d="M20 12v2a3.5 3.5 0 0 1-3.5 3.5H4"/><path d="M11.2 10.6 12.8 9.6V15"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6.5h3.5L16 17.5h4"/><path d="M16.5 14.5 20 17.5l-3.5 3"/><path d="M3 17.5h3.5L10 13"/><path d="M16.5 3.5 20 6.5l-3.5 3"/><path d="M20 6.5h-4L13 10"/></svg>',
};

/* ================== Утилиты ================== */

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function plural(count, one, few, many) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

let toastTimer = null;
function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, 2600);
}

/* ================== Модальные окна ================== */

function openModal({ title, value = '', okText = 'ОК', showInput = true, placeholder = '' }) {
  return new Promise((resolve) => {
    el.modalTitle.textContent = title;
    el.modalOk.textContent = okText;
    el.modalInput.hidden = !showInput;
    el.modalInput.value = value;
    el.modalInput.placeholder = placeholder;
    el.modalOverlay.hidden = false;
    if (showInput) {
      setTimeout(() => {
        el.modalInput.focus();
        el.modalInput.select();
      }, 30);
    } else {
      setTimeout(() => el.modalOk.focus(), 30);
    }

    const onKey = (event) => {
      if (event.key === 'Escape') close(null);
      if (event.key === 'Enter' && showInput) close(el.modalInput.value.trim());
    };
    const onOk = () => close(showInput ? el.modalInput.value.trim() : true);
    const onCancel = () => close(null);

    function close(result) {
      el.modalOverlay.hidden = true;
      el.modalOk.removeEventListener('click', onOk);
      el.modalCancel.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey, true);
      resolve(result);
    }

    el.modalOk.addEventListener('click', onOk);
    el.modalCancel.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey, true);
  });
}

/* ================== Запуск и сохранение ================== */

function cleanWeightMap(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [key, value] of Object.entries(input)) {
    const num = Number(value);
    if (key && Number.isFinite(num) && Math.abs(num) >= 0.01) out[key] = num;
  }
  return out;
}

function normalizeWaveProfile(raw) {
  return {
    genres: cleanWeightMap(raw?.genres),
    artists: cleanWeightMap(raw?.artists),
    anime: cleanWeightMap(raw?.anime),
    eras: cleanWeightMap(raw?.eras),
    types: cleanWeightMap(raw?.types),
    events: Number.isFinite(raw?.events) ? raw.events : 0,
    updatedAt: Number.isFinite(raw?.updatedAt) ? raw.updatedAt : 0,
  };
}

function normalizeWaveSettings(raw) {
  const novelty = Number(raw?.novelty);
  const mood = ['auto', 'energetic', 'calm'].includes(raw?.mood) ? raw.mood : 'auto';
  return {
    novelty: Number.isFinite(novelty) ? Math.min(1, Math.max(0, novelty)) : 0.4,
    mood,
  };
}

async function init() {
  const saved = await api.getState();
  state.playlists = Array.isArray(saved.playlists) ? saved.playlists : [];
  state.animeFavorites = Array.isArray(saved.animeFavorites) ? saved.animeFavorites : [];
  state.animeTrackStore = saved.animeTrackStore && typeof saved.animeTrackStore === 'object'
    ? saved.animeTrackStore
    : {};
  // Старые плейлисты и избранное могли ссылаться на локальные файлы,
  // которых больше нет.
  let cleaned = false;
  const beforeFavorites = state.animeFavorites.length;
  state.animeFavorites = state.animeFavorites.filter((id) => state.animeTrackStore[id]);
  if (state.animeFavorites.length !== beforeFavorites) cleaned = true;
  for (const playlist of state.playlists) {
    const before = (playlist.trackIds || []).length;
    playlist.trackIds = (playlist.trackIds || []).filter((id) => state.animeTrackStore[id]);
    if (playlist.trackIds.length !== before) cleaned = true;
  }
  if (cleaned) await persist();
  state.shuffle = Boolean(saved.shuffle);
  state.repeat = saved.repeat || 'off';
  state.volume = typeof saved.volume === 'number' ? saved.volume : 0.8;
  state.lastVolume = state.volume || 0.8;
  state.waveProfile = normalizeWaveProfile(saved.waveProfile);
  state.listenHistory = Array.isArray(saved.listenHistory) ? saved.listenHistory.slice(0, 500) : [];
  state.waveDislikes = Array.isArray(saved.waveDislikes) ? saved.waveDislikes.filter(Boolean) : [];
  state.waveSettings = normalizeWaveSettings(saved.waveSettings);

  let waveProfileCleaned = false;
  for (const artist of Object.keys(state.waveProfile.artists)) {
    if (!waveIsUnknownArtist(artist)) continue;
    delete state.waveProfile.artists[artist];
    waveProfileCleaned = true;
  }
  if (waveProfileCleaned) await persist();

  el.volume.value = Math.round(state.volume * 100);
  audio.volume = state.volume;
  updateRepeatButton();
  updateShuffleButton();

  renderSidebar();
  render();
  bindEvents();
}

async function persist() {
  await api.saveState({
    playlists: state.playlists,
    animeFavorites: state.animeFavorites,
    animeTrackStore: state.animeTrackStore,
    shuffle: state.shuffle,
    repeat: state.repeat,
    volume: state.volume,
    waveProfile: state.waveProfile,
    listenHistory: state.listenHistory,
    waveDislikes: state.waveDislikes,
    waveSettings: state.waveSettings,
  });
}

/* ================== Обложки ================== */

function loadCover(track, img) {
  if (!track?.coverUrl) return;
  img.src = track.coverUrl;
}

/* ================== Рендер сайдбара ================== */

function renderSidebar() {
  el.nav.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('is-active', item.dataset.view === state.view);
  });

  el.playlistNav.innerHTML = '';
  for (const playlist of state.playlists) {
    const button = document.createElement('button');
    button.className = 'side-item';
    if (state.view === 'playlist' && state.activePlaylistId === playlist.id) {
      button.classList.add('is-active');
    }
    button.innerHTML = `
      <span class="side-icon">♫</span>
      <span class="side-label">${escapeHtml(playlist.name)}</span>
      <span class="side-count">${(playlist.trackIds || []).length}</span>
    `;
    button.addEventListener('click', () => navigate('playlist', { activePlaylistId: playlist.id }));
    el.playlistNav.appendChild(button);
  }
}

/* ================== Навигация ================== */

function navigate(view, params = {}, addToHistory = true) {
  state.view = view;
  Object.assign(state, params);
  if (addToHistory) {
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push(view);
    state.historyIndex = state.history.length - 1;
  }
  renderSidebar();
  render();
  el.content.scrollTop = 0;
}

function goBack() {
  if (state.historyIndex > 0) {
    state.historyIndex--;
    state.view = state.history[state.historyIndex];
    renderSidebar();
    render();
  }
}

function goForward() {
  if (state.historyIndex < state.history.length - 1) {
    state.historyIndex++;
    state.view = state.history[state.historyIndex];
    renderSidebar();
    render();
  }
}

/* ================== Рендер контента ================== */

function render() {
  el.view.hidden = false;
  el.view.innerHTML = '';

  switch (state.view) {
    case 'favorites':
      renderFavorites();
      break;
    case 'playlists':
      renderPlaylists();
      break;
    case 'playlist':
      renderPlaylistView();
      break;
    case 'queue':
      renderQueue();
      break;
    case 'wave':
      renderWave();
      break;
    case 'anime':
    default:
      state.view = 'anime';
      renderAnimeView();
      break;
  }
}

/** Общий список треков для избранного, плейлиста и очереди. */
function renderCollection(title, tracks, subtitle, empty = {}) {
  el.view.appendChild(sectionTitle(title, tracks.length ? `${tracks.length}` : ''));

  if (subtitle) {
    const note = document.createElement('div');
    note.className = 'anime-facts';
    note.textContent = subtitle;
    el.view.appendChild(note);
  }

  if (!tracks.length) {
    el.view.appendChild(emptyState(
      empty.icon || '🎵',
      empty.title || 'Пока пусто',
      empty.text || 'Здесь появятся треки.'
    ));
    return;
  }

  const controls = document.createElement('div');
  controls.className = 'section-actions';
  controls.innerHTML = `
    <button class="btn btn-primary" id="btn-play-all">${ICONS.play} Слушать всё</button>
    <button class="btn btn-ghost" id="btn-shuffle-all">${ICONS.shuffle} Перемешать</button>
  `;
  el.view.appendChild(controls);

  const list = document.createElement('div');
  list.className = 'track-list anime-tracks';
  list.appendChild(animeTrackHeader());
  for (const track of tracks) {
    list.appendChild(animeTrackRow(track, tracks));
  }
  el.view.appendChild(list);

  controls.querySelector('#btn-play-all').addEventListener('click', () => playTracks(tracks, 0));
  controls.querySelector('#btn-shuffle-all').addEventListener('click', () => {
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
    playTracks(shuffled, 0);
  });
}

function renderFavorites() {
  renderCollection(
    'Моё любимое',
    tracksByIds(state.animeFavorites),
    'Опенинги и эндинги, отмеченные сердечком',
    {
      icon: '♡',
      title: 'Пока ничего нет',
      text: 'Нажмите сердечко рядом с опенингом — и он появится здесь.',
    }
  );
}

function renderQueue() {
  renderCollection(
    'Очередь',
    state.queue,
    'Треки, которые будут играть следующими',
    {
      icon: '♪',
      title: 'Очередь пуста',
      text: 'Включите любой опенинг, чтобы собрать очередь.',
    }
  );
}

function renderPlaylists() {
  el.view.appendChild(sectionTitle('Плейлисты', state.playlists.length || ''));

  if (!state.playlists.length) {
    el.view.appendChild(emptyState('♫', 'Плейлистов нет', 'Создайте свой первый плейлист и складывайте в него любимые опенинги.'));
    return;
  }

  el.view.appendChild(cardGrid(state.playlists.map((playlist) => ({
    id: `playlist-${playlist.id}`,
    title: playlist.name,
    subtitle: `${(playlist.trackIds || []).length} ${plural((playlist.trackIds || []).length, 'трек', 'трека', 'треков')}`,
    artText: '♫',
    onClick: () => navigate('playlist', { activePlaylistId: playlist.id }),
  }))));
}

function renderPlaylistView() {
  const playlist = state.playlists.find((p) => p.id === state.activePlaylistId);
  if (!playlist) {
    navigate('playlists', {}, false);
    return;
  }
  const tracks = tracksByIds(playlist.trackIds || []);

  el.view.appendChild(sectionTitle(playlist.name, ''));

  const controls = document.createElement('div');
  controls.className = 'section-actions';
  controls.innerHTML = `
    <button class="btn btn-primary" id="btn-play-all">${ICONS.play} Слушать всё</button>
    <button class="btn btn-ghost" id="btn-rename-playlist">✎ Переименовать</button>
    <button class="btn btn-ghost" id="btn-delete-playlist">🗑 Удалить</button>
  `;
  el.view.appendChild(controls);

  if (!tracks.length) {
    el.view.appendChild(emptyState('♫', 'Плейлист пуст', 'Добавьте треки через кнопку «⋯» рядом с опенингом.'));
  } else {
    const list = document.createElement('div');
    list.className = 'track-list anime-tracks';
    list.appendChild(animeTrackHeader());
    for (const track of tracks) {
      list.appendChild(animeTrackRow(track, tracks));
    }
    el.view.appendChild(list);
  }

  controls.querySelector('#btn-play-all').addEventListener('click', () => {
    if (tracks.length) playTracks(tracks, 0);
  });
  controls.querySelector('#btn-rename-playlist').addEventListener('click', async () => {
    const name = await openModal({ title: 'Переименовать плейлист', value: playlist.name, okText: 'Сохранить' });
    if (!name) return;
    playlist.name = name;
    await persist();
    renderSidebar();
    render();
  });
  controls.querySelector('#btn-delete-playlist').addEventListener('click', async () => {
    const ok = await openModal({ title: 'Удалить плейлист?', showInput: false, okText: 'Удалить' });
    if (!ok) return;
    state.playlists = state.playlists.filter((p) => p.id !== playlist.id);
    await persist();
    navigate('playlists');
  });
}

/* ================== Строители DOM ================== */

function sectionTitle(title, count) {
  const node = document.createElement('h2');
  node.className = 'section-title';
  node.innerHTML = `${escapeHtml(title)}${count !== undefined && count !== '' ? `<small>${escapeHtml(count)}</small>` : ''}`;
  return node;
}

function emptyState(icon, title, text, actions = []) {
  const node = document.createElement('div');
  node.className = 'empty-state';
  node.innerHTML = `
    <div class="empty-icon">${icon}</div>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(text)}</p>
  `;
  if (actions.length) {
    const row = document.createElement('div');
    row.className = 'section-actions';
    for (const action of actions) {
      const button = document.createElement('button');
      button.className = 'btn btn-primary';
      button.textContent = action.text;
      button.addEventListener('click', action.action);
      row.appendChild(button);
    }
    node.appendChild(row);
  }
  return node;
}

function cardGrid(cards) {
  const grid = document.createElement('div');
  grid.className = 'card-grid';
  for (const card of cards) {
    const node = document.createElement('div');
    node.className = 'card';
    node.innerHTML = `
      <div class="card-art">${card.artText}</div>
      <div class="card-title">${escapeHtml(card.title)}</div>
      <div class="card-sub">${escapeHtml(card.subtitle || '')}</div>
    `;
    node.addEventListener('click', card.onClick);
    grid.appendChild(node);
  }
  return grid;
}

/** Возвращает сохранённые треки по идентификаторам. */
function tracksByIds(ids) {
  return (ids || [])
    .map((id) => state.animeTrackStore[id])
    .filter(Boolean);
}

/* ================== Раздел «Аниме» ================== */

/**
 * Поиск аниме. Запросы отправляются с задержкой, чтобы не слать запрос на каждую букву.
 */
let animeSearchTimer = null;

/**
 * Номер текущего поколения поисковых запросов.
 * Асинхронные ответы приходят в произвольном порядке, поэтому устаревший
 * ответ отбрасывается — иначе «популярные» могли бы затереть результаты поиска.
 * Счётчик увеличивает только поиск: загрузка популярных не должна отменять
 * уже начатый пользователем запрос.
 */
let animeRequestId = 0;

function scheduleAnimeSearch(value) {
  state.anime.query = value;
  clearTimeout(animeSearchTimer);
  animeSearchTimer = setTimeout(() => runAnimeSearch(value), 420);
}

async function runAnimeSearch(query) {
  const requestId = ++animeRequestId;

  // Новый поиск — показываем результаты, а не ранее открытое аниме.
  state.anime.selected = null;
  state.anime.tracks = [];

  if (!query.trim()) {
    state.anime.results = [];
    state.anime.sources = {};
    state.anime.error = '';
    renderAnimeResults();
    return;
  }

  state.anime.loading = true;
  state.anime.error = '';
  renderAnimeResults();

  const result = await api.searchAnime(query);

  // Пока шёл запрос, пользователь мог что-то изменить — ответ больше неактуален.
  if (requestId !== animeRequestId) return;
  state.anime.loading = false;

  if (!result || !result.ok) {
    state.anime.error = result?.error || 'Не удалось выполнить поиск';
    state.anime.results = [];
    renderAnimeResults();
    return;
  }

  state.anime.results = result.results || [];
  state.anime.sources = result.sources || {};
  renderAnimeResults();
}

/** Популярные аниме — показываются, пока пользователь ничего не искал. */
async function loadPopularAnime() {
  const requestId = animeRequestId;
  const result = await api.popularAnime();

  // Если пользователь уже начал свой поиск, популярные ему не нужны.
  if (requestId !== animeRequestId) return;
  if (state.anime.query.trim() || state.anime.loading) return;

  if (result?.ok && result.results?.length) {
    state.anime.results = result.results;
    state.anime.sources = { anilist: 'ok' };
    renderAnimeResults();
  }
}

async function openAnime(anime) {
  state.anime.selected = anime;
  state.anime.tracks = [];
  state.anime.tracksLoading = true;
  state.anime.tracksError = '';
  renderAnimeResults();

  const result = await api.animeThemes({ malId: anime.malId, title: anime.title });
  state.anime.tracksLoading = false;

  if (!result || !result.ok || !result.found) {
    state.anime.tracksError = 'В базе опенингов нет данных об этом аниме';
    renderAnimeResults();
    return;
  }

  const malId = anime.malId || result.anime?.malId || null;
  const genres = Array.isArray(anime.genres) ? anime.genres : (result.anime?.genres || []);
  const year = anime.year || result.anime?.year || null;
  const score = anime.score || result.anime?.score || null;
  state.anime.tracks = (result.tracks || []).map((track) => ({
    ...track,
    // Если в базе опенингов обложки нет, берём её из карточки аниме.
    coverUrl: track.coverUrl || anime.cover || null,
    // Метаданные нужны «Моей волне», чтобы строить профиль вкусов
    // по жанрам, эпохе и рейтингу аниме.
    malId: track.malId || malId,
    animeGenres: track.animeGenres || genres,
    animeYear: track.animeYear || year,
    animeScore: track.animeScore || score,
  }));
  renderAnimeResults();
}

/** Источники поиска с пояснением, если часть из них недоступна. */
function animeSourcesNote() {
  const sources = state.anime.sources || {};
  const notes = [];
  if (sources.anilist === 'ok') notes.push('AniList');
  if (sources.shikimori === 'ok') notes.push('Shikimori');
  if (sources.shikimori === 'pending') notes.push('Shikimori уточняет…');
  if (sources.shikimori === 'unavailable') {
    notes.push('Shikimori недоступен — поиск идёт по AniList');
  }
  return notes.join(' · ');
}

function renderAnimeView() {
  const anime = state.anime;

  // Строка поиска.
  const search = document.createElement('div');
  search.className = 'anime-search';
  search.innerHTML = `
    <span class="search-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round">
        <circle cx="11" cy="11" r="6.2" /><path d="M15.6 15.6 20 20" />
      </svg>
    </span>
    <input type="search" id="anime-search-input" placeholder="Название аниме — например, «Наруто»"
           autocomplete="off" spellcheck="false" value="${escapeHtml(anime.query)}" />
  `;
  el.view.appendChild(search);

  const input = search.querySelector('#anime-search-input');
  input.addEventListener('input', () => scheduleAnimeSearch(input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      clearTimeout(animeSearchTimer);
      runAnimeSearch(input.value);
    }
    if (event.key === 'Escape') {
      input.value = '';
      scheduleAnimeSearch('');
      input.blur();
    }
  });

  // Результаты живут в отдельном контейнере: перерисовывается только он,
  // поэтому поле поиска не теряет фокус и позицию курсора.
  const results = document.createElement('div');
  results.className = 'anime-results';
  results.id = 'anime-results';
  el.view.appendChild(results);

  renderAnimeResults();
}

/** Перерисовывает только область результатов раздела «Аниме». */
function renderAnimeResults() {
  const container = document.getElementById('anime-results');
  if (!container) {
    renderAnimeView();
    return;
  }

  container.innerHTML = '';
  const anime = state.anime;

  const sourcesNote = animeSourcesNote();
  if (sourcesNote) {
    const note = document.createElement('div');
    note.className = 'anime-sources';
    note.id = 'anime-sources';
    note.textContent = sourcesNote;
    container.appendChild(note);
  }

  if (anime.loading) {
    container.appendChild(emptyState('⏳', 'Ищем…', 'Загружаем список аниме из баз данных.'));
    return;
  }

  if (anime.error) {
    container.appendChild(emptyState('⚠', 'Поиск не удался', anime.error));
    return;
  }

  // Выбранное аниме со списком опенингов.
  if (anime.selected) {
    renderAnimeDetails(anime.selected, container);
    return;
  }

  if (!anime.query.trim()) {
    container.appendChild(sectionTitle('Популярные аниме', ''));
    if (!anime.results.length) {
      container.appendChild(emptyState('🎌', 'Загружаем…', 'Собираем список популярных аниме.'));
      loadPopularAnime();
      return;
    }
    container.appendChild(animeGrid(anime.results));
    return;
  }

  if (!anime.results.length) {
    container.appendChild(emptyState('🔍', 'Ничего не найдено', `По запросу «${anime.query}» ничего нет. Попробуйте другое название.`));
    return;
  }

  container.appendChild(sectionTitle('Найденные аниме', `${anime.results.length}`));
  container.appendChild(animeGrid(anime.results));
}

function animeGrid(items) {
  const grid = document.createElement('div');
  grid.className = 'card-grid anime-grid';

  for (const anime of items) {
    const node = document.createElement('div');
    node.className = 'card';

    const title = anime.titleRu || anime.titleEn || anime.title;
    const year = anime.year ? String(anime.year) : '';
    const score = anime.score ? `★ ${Math.round(anime.score)}` : '';

    node.innerHTML = `
      <div class="card-art">${anime.cover ? `<img src="${escapeHtml(anime.cover)}" alt="" loading="lazy" />` : '🎌'}</div>
      <div class="card-title">${escapeHtml(title)}</div>
      <div class="card-sub">${escapeHtml([year, score].filter(Boolean).join(' · '))}</div>
    `;

    node.addEventListener('click', () => openAnime(anime));
    grid.appendChild(node);
  }

  return grid;
}

function renderAnimeDetails(anime, container) {
  const title = anime.titleRu || anime.titleEn || anime.title;

  const header = document.createElement('div');
  header.className = 'anime-header';

  const back = document.createElement('button');
  back.className = 'btn btn-ghost';
  back.textContent = '← Назад';
  back.addEventListener('click', () => {
    state.anime.selected = null;
    state.anime.tracks = [];
    renderAnimeResults();
  });
  header.appendChild(back);

  const cover = document.createElement('div');
  cover.className = 'anime-cover';
  cover.innerHTML = anime.cover ? `<img src="${escapeHtml(anime.cover)}" alt="" />` : '🎌';
  header.appendChild(cover);

  const info = document.createElement('div');
  info.className = 'anime-info';
  const facts = [anime.year, anime.format, anime.episodes ? `${anime.episodes} серий` : '', anime.score ? `★ ${Math.round(anime.score)}` : '']
    .filter(Boolean)
    .join(' · ');
  info.innerHTML = `
    <h2 class="anime-title">${escapeHtml(title)}</h2>
    <div class="anime-facts">${escapeHtml(facts)}</div>
    ${anime.synopsis ? `<p class="anime-synopsis">${escapeHtml(anime.synopsis)}</p>` : ''}
  `;
  header.appendChild(info);

  container.appendChild(header);

  if (state.anime.tracksLoading) {
    container.appendChild(emptyState('⏳', 'Загружаем опенинги…', 'Ищем в базе опенингов и эндингов.'));
    return;
  }

  if (state.anime.tracksError) {
    container.appendChild(emptyState('🎧', 'Опенинги не найдены', state.anime.tracksError, [
      { text: 'Искать на YouTube', action: () => searchYouTube(anime.title) },
    ]));
    return;
  }

  const tracks = state.anime.tracks;
  container.appendChild(sectionTitle('Опенинги и эндинги', `${tracks.length}`));

  const controls = document.createElement('div');
  controls.className = 'section-actions';
  controls.innerHTML = `
    <button class="btn btn-primary" id="btn-anime-play-all">${ICONS.play} Слушать всё</button>
    <button class="btn btn-ghost" id="btn-anime-shuffle">${ICONS.shuffle} Перемешать</button>
    <button class="btn btn-wave" id="btn-anime-wave">${ICONS.wave || '≈'} Моя волна</button>
  `;
  container.appendChild(controls);

  const list = document.createElement('div');
  list.className = 'track-list anime-tracks';
  list.appendChild(animeTrackHeader());

  for (const track of tracks) {
    list.appendChild(animeTrackRow(track, tracks));
  }
  container.appendChild(list);

  controls.querySelector('#btn-anime-play-all').addEventListener('click', () => playTracks(tracks, 0));
  controls.querySelector('#btn-anime-shuffle').addEventListener('click', () => {
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
    playTracks(shuffled, 0);
  });
  controls.querySelector('#btn-anime-wave').addEventListener('click', () => {
    startWave({ seedAnime: anime, fresh: true });
  });
}

function animeTrackHeader() {
  const header = document.createElement('div');
  header.className = 'track-header anime-track-header';
  header.innerHTML = `
    <span>#</span>
    <span></span>
    <span>Название</span>
    <span class="th-album">Тип</span>
    <span style="text-align:right">Время</span>
    <span></span>
  `;
  return header;
}

function animeTrackRow(track, tracks) {
  const row = document.createElement('div');
  row.className = 'track-row';
  row.dataset.id = track.id;

  const badge = track.themeType === 'ED' ? 'ED' : track.themeType === 'IN' ? 'IN' : 'OP';
  const versionNote = track.version > 1 ? ` v${track.version}` : '';

  row.innerHTML = `
    <div class="track-index">
      <span class="num">${track.trackNumber || ''}</span>
      <span class="play-hint">▶</span>
    </div>
    <div class="tr-art"></div>
    <div class="tr-main">
      <div class="tr-title">${escapeHtml(track.title)}</div>
      <div class="tr-artist">${escapeHtml(track.artist)}</div>
    </div>
    <div class="tr-album"><span class="theme-badge theme-${badge.toLowerCase()}">${badge}${versionNote}</span></div>
    <div class="tr-duration">${track.duration ? formatTime(track.duration) : '—'}</div>
    <div class="tr-actions">
      <button class="like-btn" title="В любимое">♡</button>
      <button class="video-btn" title="Смотреть опенинг">🎬</button>
      <button class="menu-btn" title="Ещё">⋯</button>
    </div>
  `;

  const art = row.querySelector('.tr-art');
  if (track.coverUrl) {
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    art.appendChild(img);
    img.src = track.coverUrl;
  }

  const likeBtn = row.querySelector('.like-btn');
  const syncLike = () => {
    const liked = isFavorite(track);
    likeBtn.textContent = liked ? '♥' : '♡';
    likeBtn.classList.toggle('is-liked', liked);
  };
  syncLike();
  likeBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleFavorite(track);
    syncLike();
  });

  row.querySelector('.video-btn').addEventListener('click', (event) => {
    event.stopPropagation();
    openVideo(track);
  });

  row.querySelector('.menu-btn').addEventListener('click', (event) => {
    event.stopPropagation();
    showTrackMenu(event, track);
  });

  row.addEventListener('click', () => playTracks(tracks, tracks.indexOf(track)));

  return row;
}

/** Открывает видео опенинга в модальном окне. */
function openVideo(track) {
  if (!track?.videoStreamUrl) {
    toast('Для этой темы нет видео');
    return;
  }

  // Видео и аудио AnimeThemes — дорожки одного ролика. Если открываем видео
  // текущего трека, начинаем с той же секунды и не запускаем два звука сразу.
  const sameTrack = state.currentId === track.id;
  videoResume = {
    trackId: state.currentId,
    wasPlaying: !audio.paused,
    time: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
    sync: sameTrack,
  };

  if (!audio.paused) audio.pause();

  const startAt = sameTrack ? videoResume.time : 0;

  el.videoTitle.textContent = `${track.title} — ${track.artist}`;
  el.videoPlayer.src = track.videoStreamUrl;
  el.videoOverlay.hidden = false;

  const startVideo = () => {
    if (!videoResume) return;
    if (startAt > 0 && Number.isFinite(el.videoPlayer.duration)) {
      el.videoPlayer.currentTime = Math.min(
        startAt,
        Math.max(0, el.videoPlayer.duration - 0.25)
      );
    }
    el.videoPlayer.play().catch(() => {
      /* автозапуск может быть заблокирован — пользователь нажмёт play */
    });
  };

  el.videoPlayer.addEventListener('loadedmetadata', startVideo, { once: true });
}

function closeVideo() {
  const resume = videoResume;
  const watched = Number.isFinite(el.videoPlayer.currentTime)
    ? el.videoPlayer.currentTime
    : 0;
  videoResume = null;

  el.videoOverlay.hidden = true;
  el.videoPlayer.pause();
  el.videoPlayer.removeAttribute('src');
  el.videoPlayer.load();

  if (!resume || state.currentId !== resume.trackId) return;

  // Если смотрели видео текущего трека — продолжаем ровно с того места,
  // где остановились. Для видео другого трека возвращаем прежнюю позицию.
  if (resume.sync && watched > 0.25) {
    let target = watched;
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      target = Math.min(target, Math.max(0, audio.duration - 0.1));
    }
    try {
      audio.currentTime = target;
    } catch {
      /* позиция может быть ещё не готова — оставляем как есть */
    }
  }

  if (resume.wasPlaying) {
    audio.play().catch(() => {
      /* пользователь сможет нажать play вручную */
    });
  }
}

/** Поиск опенинга на YouTube во внешнем браузере. */
function searchYouTube(title) {
  const query = encodeURIComponent(`${title} opening theme`);
  api.openExternal(`https://www.youtube.com/results?search_query=${query}`);
}

/* ================== «Моя волна» ================== */

/**
 * Поведенческий аналог «Моей волны»: профиль вкусов, пул кандидатов,
 * ранжирование и бесконечное пополнение очереди. Серверного Rotor здесь нет —
 * всё считается локально по избранному, плейлистам и истории прослушиваний.
 */

const WAVE_HISTORY_LIMIT = 20;
const WAVE_HISTORY_STORE_LIMIT = 500;
const WAVE_UNKNOWN_ARTISTS = new Set(['неизвестный исполнитель', 'unknown artist', 'unknown']);
let waveFillPromise = null;
let waveAdvancePromise = null;

function waveIsUnknownArtist(name) {
  const clean = String(name || '').trim().toLowerCase();
  return !clean || WAVE_UNKNOWN_ARTISTS.has(clean);
}

function waveMapValue(map, key) {
  const value = Number(map?.[key]);
  return Number.isFinite(value) ? value : 0;
}

function waveTopKeys(map, count = 5) {
  return Object.entries(map || {})
    .filter(([, value]) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([key]) => key);
}

function waveTopGenres(count = 3) {
  const fromProfile = waveTopKeys(state.waveProfile.genres, count);
  if (fromProfile.length) return fromProfile;

  const counts = new Map();
  const addGenres = (genres) => {
    for (const genre of Array.isArray(genres) ? genres : []) {
      const clean = String(genre || '').trim();
      if (clean) counts.set(clean, (counts.get(clean) || 0) + 1);
    }
  };

  for (const track of tracksByIds(state.animeFavorites)) {
    addGenres(track.animeGenres || track.genres);
  }
  for (const playlist of state.playlists) {
    for (const track of tracksByIds(playlist.trackIds || [])) {
      addGenres(track.animeGenres || track.genres);
    }
  }
  addGenres(state.anime.selected?.genres);

  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, count).map(([key]) => key);
}

function waveEffectiveMood() {
  if (state.waveSettings.mood !== 'auto') return state.waveSettings.mood;
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 12) return 'energetic';
  if (hour >= 18 || hour < 3) return 'calm';
  return 'balanced';
}

function waveProfileValue(map, key) {
  if (!key) return 0;
  const values = Object.values(map || {})
    .map((value) => Math.abs(Number(value) || 0))
    .filter(Boolean);
  const max = Math.max(1, ...values);
  return waveMapValue(map, key) / max;
}

function waveBump(map, key, delta) {
  const clean = String(key || '').trim();
  if (!clean) return;
  const current = waveMapValue(map, clean);
  map[clean] = current * 0.985 + delta;
  if (Math.abs(map[clean]) < 0.01) delete map[clean];
}

function waveBumpProfile(track, delta) {
  if (!track) return;
  const profile = state.waveProfile;
  const genres = Array.isArray(track.animeGenres)
    ? track.animeGenres
    : (Array.isArray(track.genres) ? track.genres : []);
  for (const genre of genres) waveBump(profile.genres, genre, delta);

  const artistNames = String(track.artist || '')
    .split(',')
    .map((name) => name.replace(/\s+как\s+.+$/i, '').trim())
    .filter((name) => name && !waveIsUnknownArtist(name));
  for (const artist of artistNames) waveBump(profile.artists, artist, delta);
  if (track.artist && !waveIsUnknownArtist(track.artist)) {
    waveBump(profile.artists, track.artist, delta * 0.35);
  }

  waveBump(profile.anime, track.animeTitle, delta * 0.8);
  if (Number.isFinite(track.animeYear)) {
    waveBump(profile.eras, String(Math.floor(track.animeYear / 10) * 10), delta * 0.5);
  }
  waveBump(profile.types, track.themeType, delta * 0.7);
  profile.events = (profile.events || 0) + 1;
  profile.updatedAt = Date.now();
}

function waveSeedMalIds(seedAnime) {
  const ids = [];
  const add = (value) => {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0 && !ids.includes(num)) ids.push(num);
  };
  add(seedAnime?.malId);
  add(state.anime.selected?.malId);
  for (const track of tracksByIds(state.animeFavorites)) add(track.malId);
  for (const playlist of state.playlists) {
    for (const track of tracksByIds(playlist.trackIds || [])) add(track.malId);
  }
  for (const entry of state.listenHistory.slice(0, 30)) add(entry.malId);
  return ids;
}

function waveDecorateTrack(track, target) {
  if (!track?.streamUrl) return null;
  return {
    ...track,
    malId: track.malId || target?.malId || null,
    animeGenres: (track.animeGenres?.length ? track.animeGenres : target?.genres) || [],
    animeYear: track.animeYear || target?.year || null,
    animeScore: track.animeScore || target?.score || null,
    _waveFromTitle: target?.seedTitle || '',
    _waveSource: target?._waveSource || 'discover',
  };
}

function waveLocalTracks(seedAnime, seedTrack = null) {
  const byId = new Map();
  const add = (track) => {
    if (!track?.streamUrl || !track.id || state.waveDislikes.includes(track.id)) return;
    if (byId.has(track.id)) return;
    const sameSeed = seedAnime && (
      (track.malId && track.malId === seedAnime.malId) ||
      track.animeTitle === seedAnime.title
    );
    byId.set(track.id, {
      ...track,
      malId: track.malId || (sameSeed ? seedAnime.malId : null),
      animeGenres: track.animeGenres?.length
        ? track.animeGenres
        : (sameSeed && seedAnime.genres?.length ? seedAnime.genres : []),
      animeYear: track.animeYear || (sameSeed ? seedAnime.year : null) || null,
      animeScore: track.animeScore || (sameSeed ? seedAnime.score : null) || null,
    });
  };

  if (seedTrack) add(seedTrack);
  for (const track of tracksByIds(state.animeFavorites)) add(track);
  for (const playlist of state.playlists) {
    for (const track of tracksByIds(playlist.trackIds || [])) add(track);
  }
  for (const entry of state.listenHistory.slice(0, 40)) {
    const track = state.animeTrackStore[entry.trackId];
    if (track) add(track);
  }
  if (seedAnime) {
    for (const track of state.anime.tracks) {
      if (!track.malId || track.malId === seedAnime.malId || state.anime.selected?.malId === seedAnime.malId) {
        add({ ...track, malId: track.malId || seedAnime.malId });
      }
    }
  }
  return [...byId.values()];
}

async function waveDiscoverTargets(seedAnime) {
  const seedIds = waveSeedMalIds(seedAnime).slice(0, 5);
  const genres = waveTopGenres(3);
  const [relatedResult, genreResult] = await Promise.all([
    seedIds.length
      ? api.relatedAnime(seedIds).catch(() => ({ related: [] }))
      : Promise.resolve({ related: [] }),
    genres.length
      ? api.animeByGenres(genres).catch(() => ({ results: [] }))
      : Promise.resolve({ results: [] }),
  ]);

  const used = new Set(state.wave.targets);
  const byMal = new Map();
  const add = (target, source) => {
    if (!target?.malId || used.has(target.malId)) return;
    const current = byMal.get(target.malId);
    const rating = Number(target.rating) || 0;
    if (!current) {
      byMal.set(target.malId, { ...target, rating, _waveSource: source });
    } else if (rating > current.rating) {
      byMal.set(target.malId, { ...current, ...target, rating, _waveSource: source });
    }
  };

  for (const target of relatedResult?.related || []) add(target, 'related');
  for (const target of genreResult?.results || []) add(target, 'genre');

  const seedSet = new Set(seedIds);
  let candidates = [...byMal.values()].filter((target) => !seedSet.has(target.malId));
  const genreRank = new Map(genres.map((genre, index) => [genre, genres.length - index]));
  const rank = (target) => {
    const overlap = (target.genres || []).reduce((sum, genre) => sum + (genreRank.get(genre) || 0), 0);
    return overlap * 0.8 + (Number(target.rating) || 0) / 120 + (Number(target.score) || 0) / 250 + Math.random() * 0.2;
  };
  candidates.sort((a, b) => rank(b) - rank(a));

  let chosen = candidates.slice(0, 4);
  if (!chosen.length) {
    const popular = await api.popularAnime().catch(() => ({ results: [] }));
    chosen = (popular.results || [])
      .filter((target) => target?.malId && !used.has(target.malId))
      .slice(0, 4)
      .map((target) => ({ ...target, _waveSource: 'popular' }));
  }
  if (!chosen.length) {
    // Каталог популярных уже израсходован — начинаем новый круг.
    state.wave.targets = [];
    const popular = await api.popularAnime().catch(() => ({ results: [] }));
    chosen = (popular.results || [])
      .filter((target) => target?.malId)
      .slice(0, 4)
      .map((target) => ({ ...target, _waveSource: 'popular' }));
  }

  state.wave.targets.push(...chosen.map((target) => target.malId).filter(Boolean));
  return chosen;
}

async function waveFetchCandidates(seedAnime) {
  const targets = await waveDiscoverTargets(seedAnime);
  if (!targets.length) return [];

  const results = await Promise.allSettled(targets.map(async (target) => {
    const result = await api.animeThemes({
      malId: target.malId,
      title: target.title,
      probeDurations: false,
    });
    if (!result?.ok || !result.found) return [];
    return (result.tracks || [])
      .map((track) => waveDecorateTrack(track, target))
      .filter(Boolean);
  }));

  return results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
}

function waveMergePool(tracks) {
  const known = new Set(state.wave.pool.map((track) => track.id));
  for (const track of tracks) {
    if (!track?.id || !track.streamUrl || known.has(track.id)) continue;
    if (state.waveDislikes.includes(track.id) || track.nsfw) continue;
    state.wave.pool.push(track);
    known.add(track.id);
  }
  if (state.wave.pool.length > 400) {
    state.wave.pool = state.wave.pool.slice(-400);
  }
}

function waveReasonFor(track) {
  if (isFavorite(track)) return 'Из вашего избранного';
  const artist = waveProfileValue(state.waveProfile.artists, track.artist);
  if (artist > 0.35 && track.artist && !waveIsUnknownArtist(track.artist)) {
    const name = track.artist.split(',')[0].replace(/\s+как\s+.+$/i, '').trim();
    if (name) return `Вы любите ${name}`;
  }

  const genres = Array.isArray(track.animeGenres) ? track.animeGenres : [];
  const genre = genres
    .map((name) => ({ name, value: waveProfileValue(state.waveProfile.genres, name) }))
    .sort((a, b) => b.value - a.value)[0];
  if (genre && genre.value > 0.25) return `Любимый жанр: ${genre.name}`;

  if (track._waveSource === 'related' && track._waveFromTitle) {
    return `Похоже на «${track._waveFromTitle}»`;
  }
  if (track._waveSource === 'popular') return 'Популярное аниме';
  if ((state.waveProfile.events || 0) < 3) return 'Новое для вас';
  return 'Открытие для вас';
}

function waveScoreTrack(track) {
  const profile = state.waveProfile;
  const genres = Array.isArray(track.animeGenres) ? track.animeGenres : [];
  const genreScore = genres.length
    ? genres.reduce((sum, genre) => sum + waveProfileValue(profile.genres, genre), 0) / genres.length
    : 0;
  const artistScore = waveIsUnknownArtist(track.artist)
    ? 0
    : waveProfileValue(profile.artists, track.artist);
  const animeScore = waveProfileValue(profile.anime, track.animeTitle);
  const eraKey = Number.isFinite(track.animeYear)
    ? String(Math.floor(track.animeYear / 10) * 10)
    : '';
  const eraScore = waveProfileValue(profile.eras, eraKey);
  const typeScore = waveProfileValue(profile.types, track.themeType);
  const quality = Number.isFinite(track.animeScore) ? (track.animeScore - 75) / 50 : 0;
  const known = isFavorite(track) || state.listenHistory.some((entry) => entry.trackId === track.id);
  const novelty = state.waveSettings.novelty;
  const mood = waveEffectiveMood();

  let score = genreScore * 2.1
    + artistScore * 0.85
    + animeScore * 0.55
    + eraScore * 0.22
    + typeScore * 0.22
    + quality * 0.2;

  score += known
    ? (1 - novelty) * 0.9 - novelty * 0.35
    : novelty * 1.1 - (1 - novelty) * 0.15;

  if (!profile.events) score += quality * 0.4;
  if (mood === 'energetic') {
    if (track.themeType === 'OP') score += 0.32;
    else if (track.themeType === 'ED') score -= 0.16;
  } else if (mood === 'calm') {
    if (track.themeType === 'ED') score += 0.32;
    else if (track.themeType === 'OP') score -= 0.16;
  }
  if (track.nsfw) score -= 20;
  return score;
}

function wavePickTracks(count, pool = state.wave.pool) {
  const queued = new Set(state.wave.queue.map((track) => track.id));
  const candidates = pool.filter((track) => (
    track?.streamUrl
    && track.id
    && !queued.has(track.id)
    && !state.waveDislikes.includes(track.id)
    && !track.nsfw
  ));
  const picked = [];

  while (picked.length < count && candidates.length) {
    const recent = [...state.wave.queue.slice(-4), ...picked];
    const scored = candidates.map((track) => {
      const sameAnime = recent.filter((item) => item.animeTitle === track.animeTitle).length;
      const sameArtist = recent.filter((item) => item.artist === track.artist).length;
      let score = waveScoreTrack(track) + Math.random() * 0.9;
      score -= sameAnime * 0.85;
      if (recent[0]?.animeTitle === track.animeTitle) score -= 0.9;
      score -= sameArtist * 0.45;
      return { track, score };
    }).sort((a, b) => b.score - a.score);

    const top = scored.slice(0, Math.min(12, scored.length));
    const floor = top[top.length - 1].score;
    const weights = top.map((item) => Math.exp((item.score - floor) * 1.5));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let roll = Math.random() * total;
    let choice = top[0];
    for (let i = 0; i < top.length; i++) {
      roll -= weights[i];
      if (roll <= 0) {
        choice = top[i];
        break;
      }
    }

    picked.push({ ...choice.track, _waveReason: waveReasonFor(choice.track) });
    const index = candidates.findIndex((track) => track.id === choice.track.id);
    if (index >= 0) candidates.splice(index, 1);
  }

  return picked;
}

function playWaveQueue(index) {
  if (!state.wave.queue[index]) return;
  state.wave.active = true;
  state.wave.index = index;
  state.queue = state.wave.queue;
  state.queueIndex = index;
  loadCurrent(true);
}

async function refillWave(options = {}) {
  if (!state.wave.active) return 0;
  if (waveFillPromise) return waveFillPromise;

  const unplayed = state.wave.queue.length - (state.wave.index + 1);
  if (!options.force && unplayed >= 4) return 0;

  const generation = state.wave.requestId;
  state.wave.loading = true;
  if (state.view === 'wave') renderWave();

  waveFillPromise = (async () => {
    // Даём присвоить waveFillPromise до finally даже в ветке без сетевых await.
    await Promise.resolve();
    let added = 0;
    try {
      if (generation !== state.wave.requestId) return 0;

      if (options.force || state.wave.pool.length < 8) {
        const found = await waveFetchCandidates(options.seedAnime);
        if (generation !== state.wave.requestId) return 0;
        waveMergePool(found);
      }

      let picks = wavePickTracks(options.force ? 10 : 6);
      if (!picks.length) {
        const found = await waveFetchCandidates(options.seedAnime);
        if (generation !== state.wave.requestId) return 0;
        waveMergePool(found);
        picks = wavePickTracks(6);
      }

      if (generation !== state.wave.requestId) return 0;
      if (picks.length) {
        state.wave.queue.push(...picks);
        if (state.wave.active) state.queue = state.wave.queue;
        added = picks.length;
      }
      state.wave.error = state.wave.queue.length ? '' : 'Не удалось собрать волну. Проверьте подключение к интернету.';
    } catch (err) {
      console.warn('Не удалось пополнить волну:', err);
      if (generation === state.wave.requestId && !state.wave.queue.length) {
        state.wave.error = 'Не удалось собрать волну. Проверьте подключение к интернету.';
      }
    } finally {
      if (generation === state.wave.requestId) {
        state.wave.loading = false;
        waveFillPromise = null;
        if (state.view === 'wave') renderWave();
      }
    }
    return added;
  })();

  return waveFillPromise;
}

async function startWave(options = {}) {
  const seedAnime = options.seedAnime || null;
  const seedTrack = options.seedTrack || null;
  if (state.wave.active && options.fresh === false) {
    navigate('wave');
    return;
  }

  const requestId = ++state.wave.requestId;
  waveFillPromise = null;
  waveAdvancePromise = null;
  state.wave.active = true;
  state.wave.loading = true;
  state.wave.error = '';
  state.wave.queue = [];
  state.wave.index = -1;
  state.wave.pool = [];
  state.wave.targets = [];
  state.wave.history = [];
  state.view = 'wave';
  renderSidebar();
  render();

  // Знакомые треки доступны сразу — не заставляем ждать сеть.
  const local = waveLocalTracks(seedAnime, seedTrack);
  if (local.length) {
    state.wave.pool = local;
    const initial = wavePickTracks(Math.min(12, local.length));
    if (initial.length) {
      state.wave.queue = initial;
      playWaveQueue(0);
    }
  }

  await refillWave({ force: true, seedAnime });
  if (requestId !== state.wave.requestId || !state.wave.active) return;

  state.wave.loading = false;
  if (!state.wave.queue.length) {
    state.wave.error = state.wave.error || 'Не удалось собрать волну. Попробуйте ещё раз.';
    renderWave();
    return;
  }
  if (state.wave.index < 0) playWaveQueue(0);
  else if (state.view === 'wave') renderWave();
}

function openWave() {
  // Пункт меню только открывает раздел. Воспроизведение начинается лишь
  // по явной кнопке «Слушать» / «Продолжить волну».
  navigate('wave');
  if (state.wave.active && state.wave.queue.length - (state.wave.index + 1) < 4) {
    refillWave();
  }
}

/** Продолжает уже собранную волну с сохранённого места. */
function resumeWave() {
  if (!state.wave.queue.length) {
    startWave({ fresh: true });
    return;
  }

  const index = Math.max(0, Math.min(state.wave.index, state.wave.queue.length - 1));
  state.wave.active = true;
  state.view = 'wave';
  renderSidebar();
  render();
  playWaveQueue(index);
  if (state.wave.queue.length - (index + 1) < 4) refillWave();
}

async function waveNext(auto = false) {
  if (!state.wave.active) return;
  if (waveAdvancePromise) return waveAdvancePromise;

  const generation = state.wave.requestId;
  waveAdvancePromise = (async () => {
    // Если следующий трек уже есть в очереди, не ждём фоновую догрузку.
    if (waveFillPromise && state.wave.index + 1 >= state.wave.queue.length) {
      await waveFillPromise;
    }
    if (generation !== state.wave.requestId || !state.wave.active) return;

    if (auto) {
      if (state.listenSession && !state.listenSession.recorded) finalizeListen(true);
    } else {
      finalizeListen(false);
    }

    let next = state.wave.index + 1;
    if (next >= state.wave.queue.length) {
      state.wave.loading = true;
      if (state.view === 'wave') renderWave();
      await refillWave({ force: false });
      if (generation !== state.wave.requestId || !state.wave.active) return;
      next = state.wave.index + 1;
    }

    if (next < state.wave.queue.length) {
      playWaveQueue(next);
      if (state.wave.queue.length - next < 5) refillWave();
    } else {
      audio.pause();
      toast('Волна не смогла подобрать следующий трек');
      if (state.view === 'wave') renderWave();
    }
  })();

  try {
    await waveAdvancePromise;
  } finally {
    if (generation === state.wave.requestId) waveAdvancePromise = null;
  }
}

function startListenSession(track) {
  if (!track) {
    state.listenSession = null;
    return;
  }
  state.listenSession = {
    trackId: track.id,
    track,
    startedAt: Date.now(),
    listened: 0,
    duration: Number(track.duration) || 0,
    recorded: false,
  };

  if (state.wave.active) {
    state.wave.history.unshift({
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      animeTitle: track.animeTitle,
      themeType: track.themeType,
      reason: track._waveReason || '',
      at: Date.now(),
    });
    state.wave.history = state.wave.history.slice(0, WAVE_HISTORY_LIMIT);
  }
}

function finalizeListen(completed) {
  const session = state.listenSession;
  if (!session || session.recorded) return;

  const track = session.track || state.animeTrackStore[session.trackId];
  if (!track) {
    state.listenSession = null;
    return;
  }

  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    session.duration = audio.duration;
  }
  const duration = session.duration || Number(track.duration) || 0;
  const listened = Math.max(0, Number(session.listened) || 0);
  const ratio = duration > 0 ? Math.min(1, listened / duration) : 0;
  const finished = Boolean(completed && (ratio >= 0.65 || !duration));
  const skipped = !completed && ratio < 0.45;

  session.recorded = true;
  state.listenHistory.unshift({
    trackId: track.id,
    title: track.title,
    artist: track.artist,
    animeTitle: track.animeTitle,
    malId: track.malId || null,
    themeType: track.themeType,
    genres: track.animeGenres || [],
    listened: Math.round(listened),
    duration: Math.round(duration),
    completed: finished,
    skipped,
    at: Date.now(),
  });
  if (state.listenHistory.length > WAVE_HISTORY_STORE_LIMIT) {
    state.listenHistory.length = WAVE_HISTORY_STORE_LIMIT;
  }

  if (finished) waveBumpProfile(track, 1.2);
  else if (skipped) waveBumpProfile(track, -0.5);

  persist();
  state.listenSession = null;
}

function dislikeTrack(track) {
  const target = track || currentTrack();
  if (!target) return;
  if (!state.waveDislikes.includes(target.id)) state.waveDislikes.push(target.id);
  state.wave.pool = state.wave.pool.filter((item) => item.id !== target.id);

  const queueIndex = state.wave.queue.findIndex((item) => item.id === target.id);
  const wasCurrent = queueIndex >= 0 && queueIndex === state.wave.index;
  if (queueIndex >= 0) {
    state.wave.queue.splice(queueIndex, 1);
    if (queueIndex < state.wave.index) {
      state.wave.index -= 1;
    } else if (wasCurrent) {
      // Следующий трек сдвинулся на место текущего; waveNext ждёт индекс на единицу меньше.
      state.wave.index = queueIndex - 1;
    }
    if (state.queue === state.wave.queue) state.queueIndex = state.wave.index;
  }

  waveBumpProfile(target, -4);

  if (state.listenSession?.trackId === target.id) finalizeListen(false);
  persist();
  toast('Больше не будем рекомендовать этот трек');

  if (wasCurrent && state.wave.active) {
    waveNext(true);
  } else if (state.view === 'wave') {
    renderWave();
  }
}

function updateWaveTransport() {
  const button = document.getElementById('wave-play');
  if (!button) return;
  if (!state.wave.active) {
    button.innerHTML = `${ICONS.play} Слушать волну`;
    return;
  }
  button.innerHTML = audio.paused
    ? `${ICONS.play} Слушать`
    : `${ICONS.pause} Пауза`;
}

function renderWave() {
  el.view.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'wave-header';
  header.innerHTML = `
    <div>
      <h2 class="section-title">Моя волна <small>∞</small></h2>
      <p class="wave-subtitle">Бесконечный поток опенингов и эндингов, который подстраивается под ваши вкусы.</p>
    </div>
  `;
  el.view.appendChild(header);

  if (!state.wave.active && !state.wave.queue.length) {
    const intro = document.createElement('div');
    intro.className = 'wave-intro';
    intro.innerHTML = `
      <div class="wave-intro-art">≈</div>
      <div>
        <h3>Волна начинает с популярного — дальше учится на вас</h3>
        <p>Ставьте ♥, пропускайте и отмечайте «не нравиться». Волна запомнит жанры, исполнителей и аниме, которые вам ближе.</p>
        <button class="btn btn-primary" id="wave-start">Включить волну</button>
      </div>
    `;
    el.view.appendChild(intro);
    intro.querySelector('#wave-start').addEventListener('click', () => startWave({ fresh: true }));
    return;
  }

  const current = state.wave.active
    ? currentTrack()
    : state.wave.queue[state.wave.index];

  if (!current) {
    if (state.wave.loading) {
      el.view.appendChild(emptyState('≈', 'Собираем волну…', 'Ищем треки по вашим вкусам. Это займёт несколько секунд.'));
    } else {
      el.view.appendChild(emptyState('≈', 'Волна не собралась', state.wave.error || 'Попробуйте запустить ещё раз.', [
        { text: 'Попробовать снова', action: () => startWave({ fresh: true }) },
      ]));
    }
    return;
  }

  const hero = document.createElement('section');
  hero.className = 'wave-hero';
  if (current.coverUrl) {
    const backdrop = document.createElement('img');
    backdrop.className = 'wave-hero-bg';
    backdrop.src = current.coverUrl;
    backdrop.alt = '';
    hero.appendChild(backdrop);
  }
  const shade = document.createElement('div');
  shade.className = 'wave-hero-shade';
  hero.appendChild(shade);

  const body = document.createElement('div');
  body.className = 'wave-hero-body';
  const cover = document.createElement('div');
  cover.className = 'wave-cover';
  cover.innerHTML = current.coverUrl
    ? `<img src="${escapeHtml(current.coverUrl)}" alt="" />`
    : '<span>♪</span>';
  body.appendChild(cover);

  const meta = document.createElement('div');
  meta.className = 'wave-meta';
  const type = current.themeType ? `${current.themeType}${current.trackNumber != null ? current.trackNumber : ''}` : '';
  const facts = [current.animeTitle, type].filter(Boolean).join(' · ');
  meta.innerHTML = `
    <div class="wave-eyebrow"><span class="wave-dot"></span> МОЯ ВОЛНА ${state.wave.loading ? '<span class="wave-pill">подбираем ещё…</span>' : ''}</div>
    <h2 class="wave-track-title">${escapeHtml(current.title)}</h2>
    <div class="wave-track-artist">${escapeHtml(current.artist)}</div>
    <div class="wave-track-facts">${escapeHtml(facts)}</div>
    <div class="wave-reasons">
      <span class="wave-reason">${escapeHtml(current._waveReason || waveReasonFor(current))}</span>
      ${(state.waveProfile.events || 0) < 3 ? '<span class="wave-reason wave-reason-muted">волна учится</span>' : ''}
    </div>
    <div class="wave-actions">
      <button class="btn btn-ghost wave-dislike" id="wave-dislike" title="Не рекомендовать">👎</button>
      <button class="btn btn-ghost ${isFavorite(current) ? 'is-liked' : ''}" id="wave-like">${isFavorite(current) ? '♥ В любимом' : '♡ В любимое'}</button>
      <button class="btn btn-primary" id="wave-play">${
        !state.wave.active
          ? `${ICONS.play} Слушать волну`
          : audio.paused
            ? `${ICONS.play} Слушать`
            : `${ICONS.pause} Пауза`
      }</button>
      <button class="btn btn-ghost" id="wave-skip">Дальше →</button>
      <button class="btn btn-ghost" id="wave-refresh" title="Собрать волну заново">↻</button>
    </div>
  `;
  body.appendChild(meta);
  hero.appendChild(body);
  el.view.appendChild(hero);

  if (state.wave.error && state.wave.queue.length) {
    const note = document.createElement('div');
    note.className = 'wave-note';
    note.textContent = state.wave.error;
    el.view.appendChild(note);
  }

  const settings = document.createElement('section');
  settings.className = 'wave-settings';
  const topGenres = waveTopGenres(4);
  const topArtists = waveTopKeys(state.waveProfile.artists, 3);
  const taste = [
    topGenres.length ? `жанры: ${topGenres.join(', ')}` : '',
    topArtists.length ? `исполнители: ${topArtists.join(', ')}` : '',
  ].filter(Boolean).join(' · ');
  settings.innerHTML = `
    <div class="wave-settings-head">
      <h3>Настройка волны</h3>
      <span>${state.waveSettings.mood === 'auto' ? `сейчас: ${waveEffectiveMood() === 'calm' ? 'спокойнее' : waveEffectiveMood() === 'energetic' ? 'бодрее' : 'ровно'}` : ''}</span>
    </div>
    <div class="wave-setting-row">
      <label for="wave-novelty">Знакомое</label>
      <input type="range" id="wave-novelty" min="0" max="100" value="${Math.round(state.waveSettings.novelty * 100)}" />
      <span id="wave-novelty-label">${Math.round(state.waveSettings.novelty * 100)}% нового</span>
      <span>Новое</span>
    </div>
    <div class="wave-moods">
      ${[
        ['auto', 'Авто'],
        ['energetic', 'Бодрое'],
        ['calm', 'Спокойное'],
      ].map(([value, label]) => `<button class="wave-mood ${state.waveSettings.mood === value ? 'is-active' : ''}" data-mood="${value}">${label}</button>`).join('')}
    </div>
    ${taste ? `<div class="wave-taste">${escapeHtml(taste)}</div>` : ''}
  `;
  el.view.appendChild(settings);

  const nextTracks = state.wave.queue.slice(state.wave.index + 1, state.wave.index + 4);
  const upcoming = document.createElement('section');
  upcoming.className = 'wave-section';
  upcoming.innerHTML = '<div class="wave-section-head"><h3>Дальше</h3><span>похоже на ваши вкусы</span></div>';
  const nextList = document.createElement('div');
  nextList.className = 'wave-next-list';
  if (nextTracks.length) {
    for (const [offset, track] of nextTracks.entries()) {
      const item = document.createElement('button');
      item.className = 'wave-next-item';
      item.innerHTML = `
        <span class="wave-next-num">${offset + 1}</span>
        <span class="wave-next-art">${track.coverUrl ? `<img src="${escapeHtml(track.coverUrl)}" alt="" />` : '♪'}</span>
        <span class="wave-next-main">
          <span class="wave-next-title">${escapeHtml(track.title)}</span>
          <span class="wave-next-sub">${escapeHtml(track.artist)}${track.animeTitle ? ` · ${escapeHtml(track.animeTitle)}` : ''}</span>
        </span>
        <span class="wave-next-reason">${escapeHtml(track._waveReason || '')}</span>
        <span class="wave-next-type">${escapeHtml(track.themeType || '')}</span>
      `;
      item.addEventListener('click', () => playWaveQueue(state.wave.index + 1 + offset));
      nextList.appendChild(item);
    }
  } else {
    const loading = document.createElement('div');
    loading.className = 'wave-next-empty';
    loading.textContent = state.wave.loading ? 'Подбираем следующие треки…' : 'Дальше пока пусто';
    nextList.appendChild(loading);
  }
  upcoming.appendChild(nextList);
  el.view.appendChild(upcoming);

  const history = document.createElement('section');
  history.className = 'wave-section';
  history.innerHTML = '<div class="wave-section-head"><h3>История волны</h3><span>последние треки</span></div>';
  const historyList = document.createElement('div');
  historyList.className = 'wave-history';
  if (state.wave.history.length) {
    for (const entry of state.wave.history.slice(0, 8)) {
      const row = document.createElement('div');
      row.className = 'wave-history-row';
      row.innerHTML = `
        <span class="wave-history-art">${entry.themeType || '♪'}</span>
        <span class="wave-history-main">
          <span class="wave-history-title">${escapeHtml(entry.title || '')}</span>
          <span class="wave-history-sub">${escapeHtml(entry.artist || '')}${entry.animeTitle ? ` · ${escapeHtml(entry.animeTitle)}` : ''}</span>
        </span>
        <span class="wave-history-reason">${escapeHtml(entry.reason || '')}</span>
      `;
      historyList.appendChild(row);
    }
  } else {
    const empty = document.createElement('div');
    empty.className = 'wave-next-empty';
    empty.textContent = 'Здесь появятся треки, которые уже сыграли.';
    historyList.appendChild(empty);
  }
  history.appendChild(historyList);
  el.view.appendChild(history);

  const footer = document.createElement('p');
  footer.className = 'wave-hint';
  footer.textContent = 'Волна учится на лайках, пропусках и дослушиваниях. Всё хранится только на этом компьютере.';
  el.view.appendChild(footer);

  hero.querySelector('#wave-dislike').addEventListener('click', () => dislikeTrack(current));
  hero.querySelector('#wave-like').addEventListener('click', () => {
    toggleFavorite(current);
  });
  hero.querySelector('#wave-play').addEventListener('click', () => {
    if (!state.wave.active) resumeWave();
    else togglePlay();
  });
  hero.querySelector('#wave-skip').addEventListener('click', () => waveNext(false));
  hero.querySelector('#wave-refresh').addEventListener('click', () => startWave({ fresh: true }));

  const novelty = settings.querySelector('#wave-novelty');
  const noveltyLabel = settings.querySelector('#wave-novelty-label');
  novelty.addEventListener('input', () => {
    state.waveSettings.novelty = Number(novelty.value) / 100;
    noveltyLabel.textContent = `${novelty.value}% нового`;
  });
  novelty.addEventListener('change', persist);
  settings.querySelectorAll('.wave-mood').forEach((button) => {
    button.addEventListener('click', () => {
      state.waveSettings.mood = button.dataset.mood;
      persist();
      renderWave();
    });
  });
}

/* ================== Воспроизведение ================== */

function playTracks(tracks, index) {
  if (!tracks.length) return;
  // Ручной запуск другого списка ставит волну на паузу, но её очередь
  // остаётся в памяти — к ней можно вернуться из раздела «Моя волна».
  if (state.wave.active) state.wave.active = false;
  state.queue = tracks;
  state.queueIndex = index;
  loadCurrent(true);
}

function currentTrack() {
  return state.queue[state.queueIndex] || null;
}

/**
 * Длительность трека.
 * Некоторые файлы Chromium отдаёт как Infinity, поэтому берём значение,
 * которое уже известно из базы или было получено при прошлом воспроизведении.
 */
function effectiveDuration() {
  if (Number.isFinite(audio.duration) && audio.duration > 0) return audio.duration;
  const track = currentTrack();
  return track && track.duration ? track.duration : 0;
}

function loadCurrent(autoplay) {
  const track = currentTrack();
  if (!track) return;

  // Предыдущий трек считаем пропущенным, если он не был завершён явно.
  if (state.listenSession && state.listenSession.trackId !== track.id) {
    finalizeListen(false);
  }

  if (state.wave.active) {
    state.wave.index = state.queueIndex;
    if (state.queue !== state.wave.queue && state.wave.queue[state.queueIndex]?.id === track.id) {
      state.queue = state.wave.queue;
    }
  }

  state.currentId = track.id;
  audio.src = track.streamUrl || '';

  el.npTitle.textContent = track.title;
  el.npArtist.textContent = `${track.artist} — ${track.album}`;
  el.timeTotal.textContent = formatTime(track.duration || 0);
  el.timeCurrent.textContent = '0:00';
  el.seek.value = 0;

  const cover = el.npCover;
  cover.innerHTML = '';
  if (track.coverUrl) {
    const img = document.createElement('img');
    img.alt = '';
    cover.appendChild(img);
    loadCover(track, img);
  } else {
    cover.innerHTML = '<span>♪</span>';
  }

  startListenSession(track);
  updateLikeButton();
  updateMediaSession(track);

  if (autoplay) {
    audio.play().catch((err) => {
      console.warn('Не удалось запустить воспроизведение:', err);
      toast('Не удалось открыть трек');
    });
  }
  markPlayingRow();
  if (state.view === 'wave') renderWave();
}

function togglePlay() {
  if (!currentTrack()) {
    const list = state.anime.tracks.length ? state.anime.tracks : tracksByIds(state.animeFavorites);
    if (list.length) {
      playTracks(list, 0);
    } else {
      toast('Выберите опенинг или эндинг');
    }
    return;
  }
  if (audio.paused) {
    audio.play().catch(() => toast('Не удалось открыть трек'));
  } else {
    audio.pause();
  }
}

function playNext(auto = false) {
  if (!state.queue.length) return;

  if (state.wave.active) {
    waveNext(auto);
    return;
  }

  if (!auto) finalizeListen(false);

  if (state.shuffle && state.queue.length > 1) {
    let next = state.queueIndex;
    while (next === state.queueIndex) next = Math.floor(Math.random() * state.queue.length);
    state.queueIndex = next;
    loadCurrent(true);
    return;
  }

  if (state.queueIndex + 1 < state.queue.length) {
    state.queueIndex++;
    loadCurrent(true);
    return;
  }

  if (state.repeat === 'all') {
    state.queueIndex = 0;
    loadCurrent(true);
    return;
  }

  if (auto) {
    audio.pause();
    audio.currentTime = 0;
  }
}

function playPrev() {
  if (!state.queue.length) return;
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }

  if (state.wave.active) {
    finalizeListen(false);
    if (state.wave.index > 0) playWaveQueue(state.wave.index - 1);
    else audio.currentTime = 0;
    return;
  }

  finalizeListen(false);
  if (state.queueIndex > 0) {
    state.queueIndex--;
    loadCurrent(true);
  } else {
    audio.currentTime = 0;
  }
}

function markPlayingRow() {
  document.querySelectorAll('.track-row').forEach((row) => {
    row.classList.toggle('is-playing', row.dataset.id === state.currentId);
  });
}

/** Обновляет время в уже отрисованной строке трека. */
function updateDurationRow(id, duration) {
  document.querySelectorAll('.track-row').forEach((row) => {
    if (row.dataset.id !== id) return;
    const cell = row.querySelector('.tr-duration');
    if (cell) cell.textContent = formatTime(duration);
  });
}

/**
 * Chromium знает точную длительность после загрузки метаданных —
 * используем её, если фоновый разбор файла ещё не успел.
 */
function syncDurationFromAudio() {
  const track = currentTrack();
  if (!track) return;
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;

  const seconds = Math.round(audio.duration);
  if (!seconds) return;

  track.duration = seconds;

  const stored = state.animeTrackStore[track.id];
  if (stored) stored.duration = seconds;

  const listed = state.anime.tracks.find((t) => t.id === track.id);
  if (listed) listed.duration = seconds;

  updateDurationRow(track.id, seconds);
}

/* ================== Избранное и плейлисты ================== */

/** Проверяет, в избранном ли трек. */
function isFavorite(track) {
  return Boolean(track && state.animeFavorites.includes(track.id));
}

/** Сохраняет данные трека, чтобы он не потерялся при перезапуске. */
function rememberTrack(track) {
  if (!track?.streamUrl) return;
  state.animeTrackStore[track.id] = track;
}

function toggleFavorite(track) {
  if (!track) return;
  rememberTrack(track);

  const index = state.animeFavorites.indexOf(track.id);
  if (index >= 0) {
    state.animeFavorites.splice(index, 1);
    toast('Убрано из любимого');
  } else {
    state.animeFavorites.unshift(track.id);
    waveBumpProfile(track, 3);
    toast('Добавлено в любимое');
  }

  updateLikeButton();
  persist();
  if (state.view === 'favorites') render();
  else if (state.view === 'wave') renderWave();
}

function updateLikeButton() {
  const track = currentTrack();
  const liked = isFavorite(track);
  el.npLike.innerHTML = liked ? ICONS.heartFilled : ICONS.heart;
  el.npLike.classList.toggle('is-liked', liked);
}

async function createPlaylist() {
  const name = await openModal({ title: 'Новый плейлист', placeholder: 'Название плейлиста', okText: 'Создать' });
  if (!name) return;
  state.playlists.push({ id: `pl-${Date.now()}`, name, trackIds: [] });
  await persist();
  renderSidebar();
  toast(`Плейлист «${name}» создан`);
}

async function addToPlaylist(track) {
  rememberTrack(track);

  if (!state.playlists.length) {
    await pickPlaylist(track);
    return;
  }
  const selected = await pickPlaylist(track);
  if (!selected) return;
  const playlist = state.playlists.find((p) => p.id === selected);
  if (!playlist) return;

  playlist.trackIds = playlist.trackIds || [];
  if (!playlist.trackIds.includes(track.id)) {
    playlist.trackIds.push(track.id);
    waveBumpProfile(track, 1.5);
    await persist();
    renderSidebar();
    toast(`Добавлено в «${playlist.name}»`);
  } else {
    toast('Трек уже в этом плейлисте');
  }
}

function pickPlaylist(track) {
  return new Promise((resolve) => {
    el.modalTitle.textContent = 'Добавить в плейлист';
    el.modalInput.hidden = true;
    el.modalOk.hidden = true;
    el.modalCancel.textContent = 'Отмена';

    const list = document.createElement('div');
    list.className = 'playlist-picker';
    for (const playlist of state.playlists) {
      const item = document.createElement('button');
      item.className = 'side-item';
      item.innerHTML = `<span class="side-icon">♫</span><span class="side-label">${escapeHtml(playlist.name)}</span>`;
      item.addEventListener('click', () => {
        close();
        resolve(playlist.id);
      });
      list.appendChild(item);
    }

    const newItem = document.createElement('button');
    newItem.className = 'side-item';
    newItem.innerHTML = '<span class="side-icon">＋</span><span class="side-label">Создать новый</span>';
    newItem.addEventListener('click', async () => {
      close();
      const name = await openModal({ title: 'Новый плейлист', placeholder: 'Название', okText: 'Создать' });
      if (!name) {
        resolve(null);
        return;
      }
      const playlist = { id: `pl-${Date.now()}`, name, trackIds: [track.id] };
      state.playlists.push(playlist);
      await persist();
      renderSidebar();
      resolve(playlist.id);
    });
    list.appendChild(newItem);

    el.modal.querySelector('.modal-input').after(list);
    el.modalOverlay.hidden = false;

    function close() {
      el.modalOverlay.hidden = true;
      el.modalOk.hidden = false;
      el.modalCancel.textContent = 'Отмена';
      list.remove();
      el.modalCancel.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey, true);
    }
    const onCancel = () => {
      close();
      resolve(null);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') onCancel();
    };
    el.modalCancel.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey, true);
  });
}

/* ================== Контекстное меню трека ================== */

function showTrackMenu(event, track) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.innerHTML = `
    <button data-action="play">▶ Слушать</button>
    <button data-action="wave">≈ Волна по этому треку</button>
    <button data-action="like">${isFavorite(track) ? '♥ Убрать из любимого' : '♡ В любимое'}</button>
    <button data-action="playlist">♫ Добавить в плейлист</button>
    <button data-action="dislike">👎 Не рекомендовать</button>
    ${track.videoStreamUrl ? '<div class="context-sep"></div><button data-action="video">🎬 Смотреть опенинг</button>' : ''}
  `;
  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(event.clientX, window.innerWidth - rect.width - 10)}px`;
  menu.style.top = `${Math.min(event.clientY, window.innerHeight - rect.height - 10)}px`;

  menu.addEventListener('click', async (menuEvent) => {
    const action = menuEvent.target.dataset.action;
    closeContextMenu();
    if (!action) return;
    if (action === 'play') {
      let list = [track];
      if (state.view === 'anime' && state.anime.tracks.length) {
        list = state.anime.tracks;
      } else if (state.view === 'favorites') {
        const favorites = tracksByIds(state.animeFavorites);
        if (favorites.length) list = favorites;
      } else if (state.view === 'playlist') {
        const playlist = state.playlists.find((p) => p.id === state.activePlaylistId);
        const playlistTracks = playlist ? tracksByIds(playlist.trackIds || []) : [];
        if (playlistTracks.length) list = playlistTracks;
      } else if (state.view === 'queue' && state.queue.length) {
        list = state.queue;
      }
      const index = list.findIndex((t) => t.id === track.id);
      playTracks(list, index >= 0 ? index : 0);
    } else if (action === 'wave') {
      startWave({
        fresh: true,
        seedAnime: {
          malId: track.malId,
          title: track.animeTitle,
          genres: track.animeGenres || [],
          year: track.animeYear,
          score: track.animeScore,
        },
        seedTrack: track,
      });
    } else if (action === 'like') {
      toggleFavorite(track);
      render();
    } else if (action === 'playlist') {
      await addToPlaylist(track);
    } else if (action === 'dislike') {
      dislikeTrack(track);
      if (state.view !== 'wave') render();
    } else if (action === 'video') {
      openVideo(track);
    }
  });

  setTimeout(() => {
    document.addEventListener('click', closeContextMenu, { once: true });
  }, 0);
}

function closeContextMenu() {
  document.querySelectorAll('.context-menu').forEach((node) => node.remove());
}

/* ================== Media Session ================== */

function updateMediaSession(track) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
    });
    navigator.mediaSession.setActionHandler('play', () => audio.play());
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('previoustrack', playPrev);
    navigator.mediaSession.setActionHandler('nexttrack', () => playNext());
  } catch {
    /* не все платформы поддерживают все действия */
  }
}

/* ================== Обработчики ================== */

function bindEvents() {
  el.nav.addEventListener('click', (event) => {
    const item = event.target.closest('.nav-item');
    if (!item) return;
    if (item.dataset.view === 'wave') {
      openWave();
      return;
    }
    navigate(item.dataset.view);
  });

  el.btnNewPlaylist.addEventListener('click', createPlaylist);
  el.btnPlay.addEventListener('click', togglePlay);
  el.btnPrev.addEventListener('click', playPrev);
  el.btnNext.addEventListener('click', () => playNext());
  el.btnBack.addEventListener('click', goBack);
  el.btnForward.addEventListener('click', goForward);

  el.btnShuffle.addEventListener('click', () => {
    state.shuffle = !state.shuffle;
    updateShuffleButton();
    persist();
    toast(state.shuffle ? 'Перемешивание включено' : 'Перемешивание выключено');
  });

  el.btnRepeat.addEventListener('click', () => {
    state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
    updateRepeatButton();
    persist();
    toast(
      state.repeat === 'off' ? 'Повтор выключен'
        : state.repeat === 'all' ? 'Повтор всех треков'
          : 'Повтор одного трека'
    );
  });

  el.btnMute.addEventListener('click', () => {
    if (audio.volume > 0) {
      state.lastVolume = audio.volume;
      audio.volume = 0;
    } else {
      audio.volume = state.lastVolume || 0.8;
    }
    el.volume.value = Math.round(audio.volume * 100);
  });

  el.npLike.addEventListener('click', () => {
    const track = currentTrack();
    if (!track) return;
    toggleFavorite(track);
    document.querySelectorAll('.track-row').forEach((row) => {
      if (row.dataset.id === track.id) {
        const likeBtn = row.querySelector('.like-btn');
        const liked = isFavorite(track);
        likeBtn.textContent = liked ? '♥' : '♡';
        likeBtn.classList.toggle('is-liked', liked);
      }
    });
  });

  el.volume.addEventListener('input', () => {
    const value = Number(el.volume.value) / 100;
    audio.volume = value;
    state.volume = value;
    if (value > 0) state.lastVolume = value;
  });
  el.volume.addEventListener('change', persist);

  el.seek.addEventListener('input', () => {
    const total = effectiveDuration();
    if (!total) return;
    const ratio = Number(el.seek.value) / 1000;
    const target = ratio * total;
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = Math.min(audio.duration, target);
    } else if (Number.isFinite(audio.seekable.length) && audio.seekable.length) {
      const start = audio.seekable.start(0);
      const end = audio.seekable.end(audio.seekable.length - 1);
      audio.currentTime = start + ratio * (end - start);
    }
  });

  el.btnQueue.addEventListener('click', () => {
    if (!state.queue.length) {
      toast('Очередь пуста');
      return;
    }
    navigate('queue');
  });

  el.videoClose.addEventListener('click', closeVideo);
  el.videoPlayer.addEventListener('ended', closeVideo);
  el.videoOverlay.addEventListener('click', (event) => {
    if (event.target === el.videoOverlay) closeVideo();
  });

  // Медленный источник уточняет результаты поиска — обновляем список.
  api.onAnimeEnriched((payload) => {
    if (state.view !== 'anime') return;
    if (payload.query !== state.anime.query.trim()) return;
    if (state.anime.loading) return;
    state.anime.results = payload.results || [];
    state.anime.sources = payload.sources || {};
    renderAnimeResults();
  });

  // Длительность опенингов приходит по одному треку — обновляем строки на месте.
  api.onAnimeDurations((payload) => {
    const durations = payload.durations || {};
    for (const [id, duration] of Object.entries(durations)) {
      if (!duration) continue;
      const track = state.anime.tracks.find((t) => t.id === id);
      if (track) track.duration = duration;
      if (state.animeTrackStore[id]) state.animeTrackStore[id].duration = duration;
      updateDurationRow(id, duration);
    }
  });

  audio.addEventListener('timeupdate', () => {
    if (state.listenSession) {
      state.listenSession.listened = Math.max(state.listenSession.listened, audio.currentTime);
    }
    const total = effectiveDuration();
    if (!total) return;
    el.seek.value = Math.min(1000, Math.round((audio.currentTime / total) * 1000));
    el.timeCurrent.textContent = formatTime(audio.currentTime);
  });

  audio.addEventListener('loadedmetadata', () => {
    const total = effectiveDuration();
    if (total) el.timeTotal.textContent = formatTime(total);
    syncDurationFromAudio();
  });

  audio.addEventListener('play', () => {
    state.isPlaying = true;
    el.btnPlay.innerHTML = ICONS.pause;
    el.btnPlay.classList.add('is-playing');
    updateWaveTransport();
  });

  audio.addEventListener('pause', () => {
    state.isPlaying = false;
    el.btnPlay.innerHTML = ICONS.play;
    el.btnPlay.classList.remove('is-playing');
    updateWaveTransport();
  });

  audio.addEventListener('ended', () => {
    if (state.listenSession) finalizeListen(true);
    if (state.repeat === 'one' && !state.wave.active) {
      startListenSession(currentTrack());
      audio.currentTime = 0;
      audio.play();
      return;
    }
    playNext(true);
  });

  audio.addEventListener('error', () => {
    if (currentTrack()) toast('Не удалось открыть трек');
  });

  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

    // Видео опенинга перехватывает Escape.
    if (!el.videoOverlay.hidden) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeVideo();
      }
      return;
    }

    if (typing) return;

    switch (event.key) {
      case ' ':
        event.preventDefault();
        togglePlay();
        break;
      case 'ArrowRight':
        if (event.shiftKey) playNext();
        else if (Number.isFinite(audio.duration)) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
        break;
      case 'ArrowLeft':
        if (event.shiftKey) playPrev();
        else if (Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, audio.currentTime - 5);
        break;
      case 'ArrowUp':
        event.preventDefault();
        audio.volume = Math.min(1, audio.volume + 0.05);
        el.volume.value = Math.round(audio.volume * 100);
        break;
      case 'ArrowDown':
        event.preventDefault();
        audio.volume = Math.max(0, audio.volume - 0.05);
        el.volume.value = Math.round(audio.volume * 100);
        break;
      case 'f':
        focusAnimeSearch();
        break;
      default:
        break;
    }
  });
}

/** Фокус в поиск аниме — при необходимости сначала открывает раздел. */
function focusAnimeSearch() {
  const focus = () => {
    const input = document.getElementById('anime-search-input');
    if (input) {
      input.focus();
      input.select();
    }
  };
  if (state.view !== 'anime') {
    navigate('anime');
    setTimeout(focus, 30);
  } else {
    focus();
  }
}

function updateShuffleButton() {
  el.btnShuffle.classList.toggle('is-on', state.shuffle);
}

function updateRepeatButton() {
  el.btnRepeat.classList.toggle('is-on', state.repeat !== 'off');
  el.btnRepeat.innerHTML = state.repeat === 'one' ? ICONS.repeatOne : ICONS.repeat;
}

/* ================== Старт ================== */

init();
