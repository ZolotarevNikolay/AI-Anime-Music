'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  nativeTheme,
  protocol,
  Tray,
  Menu,
  nativeImage,
  dialog,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

const {
  searchAnime,
  getAnimeThemes,
  getPopularAnime,
  getAnimeRecommendations,
  getAnimeByGenres,
} = require('./lib/anime');
const { RemoteCache, remoteUrl, handleRemote, resolveRemote, extractToken } = require('./lib/remote');

const IS_DEV = process.argv.includes('--dev');

// Имя приложения меняется на «AI Anime Music», но данные должны остаться
// в прежней папке, иначе избранное, волна и кэш будут выглядеть потерянными.
const LEGACY_USER_DATA = path.join(app.getPath('appData'), 'music-player');
try {
  fs.mkdirSync(LEGACY_USER_DATA, { recursive: true });
  app.setPath('userData', LEGACY_USER_DATA);
} catch (err) {
  console.error('Не удалось задать папку данных:', err);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();

/**
 * Собственный протокол для удалённых аудио и видео.
 * Работает независимо от политик https и позволяет держать CSP строгим.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

/** Кэш скачанных опенингов и эндингов. */
let remoteCache = null;

let mainWindow = null;
let tray = null;
let isQuitting = false;
let updateCheckInFlight = false;

app.on('second-instance', () => {
  if (app.isReady()) showMainWindow();
});

/** Настройки и состояние пользователя. */
const statePath = path.join(app.getPath('userData'), 'state.json');
const defaultState = {
  playlists: [],
  animeFavorites: [],
  animeTrackStore: {},
  volume: 0.8,
  shuffle: false,
  repeat: 'off',
  // Локальный профиль вкусов и обратная связь для «Моей волны».
  waveProfile: { genres: {}, artists: {}, anime: {}, eras: {}, types: {}, events: 0, updatedAt: 0 },
  listenHistory: [],
  waveDislikes: [],
  waveSettings: { novelty: 0.4, mood: 'auto' },
};

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const next = { ...defaultState };
    // Берём только известные ключи: старые настройки локальной библиотеки
    // (папки, локальное избранное) больше не нужны и не должны копиться.
    for (const key of Object.keys(defaultState)) {
      if (parsed[key] !== undefined) next[key] = parsed[key];
    }
    return next;
  } catch {
    return { ...defaultState };
  }
}

function writeState(patch) {
  try {
    const current = readState();
    const next = { ...current, ...patch };
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(next, null, 2), 'utf8');
    return next;
  } catch (err) {
    console.error('Не удалось сохранить состояние:', err);
    return readState();
  }
}

function createWindow() {
  nativeTheme.themeSource = 'dark';

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: '#0d0d12',
    title: 'AI Anime Music',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Даже в трее волна должна продолжать добирать треки и играть.
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (IS_DEV) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.on('close', (event) => {
    // Закрытие окна не завершает приложение: оно остаётся в трее,
    // а воспроизведение и «Моя волна» продолжают работать.
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Внешние ссылки открываем в браузере, а не внутри приложения.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function messageBox(options) {
  const parent =
    mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? mainWindow : undefined;
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
}

function createTray() {
  if (tray) return;

  let image = nativeImage.createFromPath(path.join(__dirname, 'build', 'tray.png'));
  if (image.isEmpty()) {
    image = nativeImage
      .createFromPath(path.join(__dirname, 'icon.png'))
      .resize({ width: 16, height: 16, quality: 'best' });
  }
  if (image.isEmpty()) {
    console.warn('Не удалось загрузить иконку трея');
    return;
  }

  tray = new Tray(image);
  tray.setToolTip('AI Anime Music');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Открыть', click: showMainWindow },
      { label: 'Проверить обновления', click: () => void checkForUpdates(true) },
      { type: 'separator' },
      {
        label: 'Выход',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('double-click', showMainWindow);
}

async function checkForUpdates(manual = false) {
  if (!app.isPackaged) {
    if (manual) {
      await messageBox({
        type: 'info',
        title: 'Обновления',
        message: 'Проверка обновлений доступна в установленной версии AI Anime Music.',
        buttons: ['ОК'],
      });
    }
    return;
  }

  if (updateCheckInFlight) {
    if (manual) {
      await messageBox({
        type: 'info',
        title: 'Обновления',
        message: 'Проверка обновлений уже выполняется.',
        buttons: ['ОК'],
      });
    }
    return;
  }

  updateCheckInFlight = true;
  try {
    const result = await autoUpdater.checkForUpdates();
    if (manual && result?.updateInfo?.version === app.getVersion()) {
      await messageBox({
        type: 'info',
        title: 'Обновления',
        message: `У вас последняя версия AI Anime Music (${app.getVersion()}).`,
        buttons: ['ОК'],
      });
    }
  } catch (err) {
    console.error('Ошибка проверки обновлений:', err);
    if (manual) {
      await messageBox({
        type: 'error',
        title: 'Обновления',
        message: 'Не удалось проверить обновления.',
        detail: 'Проверьте подключение к интернету и попробуйте позже.',
        buttons: ['ОК'],
      });
    }
  } finally {
    updateCheckInFlight = false;
  }
}

function setupAutoUpdater() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => {
    console.error('Ошибка автообновления:', err);
  });

  autoUpdater.on('update-available', (info) => {
    console.log(`Доступно обновление ${info.version}, скачиваем в фоне`);
  });

  let updatePromptOpen = false;
  autoUpdater.on('update-downloaded', async (info) => {
    if (updatePromptOpen) return;
    updatePromptOpen = true;
    try {
      const result = await messageBox({
        type: 'info',
        title: 'Обновление готово',
        message: `Версия ${info.version} загружена.`,
        detail:
          'Перезапустить приложение сейчас? Музыка прервётся только после перезапуска. ' +
          'Если выбрать «Позже», обновление установится при следующем выходе.',
        buttons: ['Перезапустить и обновить', 'Позже'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (result.response === 0) {
        isQuitting = true;
        autoUpdater.quitAndInstall(false, true);
      }
    } finally {
      updatePromptOpen = false;
    }
  });

  // Не мешаем запуску: первая проверка через 12 секунд, затем раз в 4 часа.
  setTimeout(() => void checkForUpdates(false), 12_000);
  const timer = setInterval(() => void checkForUpdates(false), 4 * 60 * 60 * 1000);
  if (typeof timer.unref === 'function') timer.unref();
}

/* ------------------------------------------------------------------ */
/*  IPC: состояние                                                      */
/* ------------------------------------------------------------------ */

ipcMain.handle('library:state', async () => readState());

ipcMain.handle('library:saveState', async (event, patch) => {
  if (!patch || typeof patch !== 'object') return readState();
  return writeState(patch);
});

/* ------------------------------------------------------------------ */
/*  IPC: аниме                                                          */
/* ------------------------------------------------------------------ */

/** Обложка аниме отдаётся через собственный протокол — так CSP остаётся строгим. */
function proxyCover(url) {
  if (!url) return null;
  return remoteUrl(url);
}

ipcMain.handle('anime:search', async (event, query) => {
  try {
    const { results, sources } = await searchAnime(query, {
      // Shikimori отвечает медленно — уточнённый список приходит отдельным событием.
      onEnriched: (enriched) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('anime:enriched', {
            query: String(query || '').trim(),
            sources: enriched.sources,
            results: enriched.results.map((anime) => ({ ...anime, cover: proxyCover(anime.cover) })),
          });
        }
      },
    });
    return {
      ok: true,
      sources,
      results: results.map((anime) => ({ ...anime, cover: proxyCover(anime.cover) })),
    };
  } catch (err) {
    return { ok: false, error: err.message, sources: {}, results: [] };
  }
});

ipcMain.handle('anime:related', async (event, malIds) => {
  try {
    const { seeds, related } = await getAnimeRecommendations(malIds);
    const withCover = (anime) => ({ ...anime, cover: proxyCover(anime.cover) });
    return {
      ok: true,
      seeds: seeds.map(withCover),
      related: related.map(withCover),
    };
  } catch (err) {
    return { ok: false, error: err.message, seeds: [], related: [] };
  }
});

ipcMain.handle('anime:genres', async (event, genres) => {
  try {
    const results = await getAnimeByGenres(genres);
    return {
      ok: true,
      results: results.map((anime) => ({ ...anime, cover: proxyCover(anime.cover) })),
    };
  } catch (err) {
    return { ok: false, error: err.message, results: [] };
  }
});

ipcMain.handle('anime:popular', async () => {
  try {
    const results = await getPopularAnime();
    return {
      ok: true,
      results: results.map((anime) => ({ ...anime, cover: proxyCover(anime.cover) })),
    };
  } catch (err) {
    return { ok: false, error: err.message, results: [] };
  }
});

ipcMain.handle('anime:themes', async (event, target) => {
  try {
    const { anime, tracks, found } = await getAnimeThemes(target || {}, {
      // Волна запрашивает пачку тем без массового чтения длительностей.
      probeDurations: target?.probeDurations !== false,
      // Длительность узнаётся в фоне — сообщаем о каждой готовой сразу.
      onDurations: (durations) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('anime:durations', {
            malId: Number(target?.malId) || null,
            durations: Object.fromEntries(durations),
          });
        }
      },
    });
    if (!anime || !found) {
      return { ok: false, found: false, anime: null, tracks: [] };
    }
    const cover = proxyCover(anime.cover);
    return {
      ok: true,
      found: true,
      anime: { ...anime, cover },
      tracks: tracks.map((track) => ({
        ...track,
        coverUrl: cover,
        audioUrl: track.audioUrl,
        streamUrl: remoteUrl(track.audioUrl),
        videoStreamUrl: track.videoUrl ? remoteUrl(track.videoUrl) : null,
      })),
    };
  } catch (err) {
    return { ok: false, found: false, error: err.message, anime: null, tracks: [] };
  }
});

/** Открыть внешнюю ссылку (например, поиск в YouTube). */
ipcMain.handle('media:openExternal', async (event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  await shell.openExternal(url);
  return true;
});

/* ------------------------------------------------------------------ */
/*  Запуск                                                              */
/* ------------------------------------------------------------------ */

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;

  // Группировка окон и уведомлений в панели задач Windows.
  app.setAppUserModelId('com.zolotarevnikolay.aianimemusic');

  remoteCache = new RemoteCache(path.join(app.getPath('userData'), 'anime-cache'));

  // Перезаписываем состояние: так из него исчезают ключи локальной библиотеки,
  // которая больше не используется.
  writeState({});

  if (typeof protocol.handle === 'function') {
    // Electron 25+: новый API на основе fetch/Response.
    protocol.handle('media', async (request) => {
      try {
        const url = new URL(request.url);
        if (url.hostname !== 'remote') {
          return new Response('Forbidden', { status: 403 });
        }

        const token = extractToken(request.url);
        const range = request.headers.get('Range') || request.headers.get('range');
        const response = await resolveRemote(token, range, remoteCache);
        if (!response.stream) {
          return new Response('Error', { status: response.statusCode || 502 });
        }
        const body = new ReadableStream({
          start(controller) {
            response.stream.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk)));
            response.stream.on('end', () => controller.close());
            response.stream.on('error', () => controller.error());
          },
        });
        return new Response(body, {
          status: response.statusCode,
          headers: response.headers,
        });
      } catch {
        return new Response('Bad request', { status: 400 });
      }
    });
  } else {
    // Electron 20–24: потоковый протокол.
    protocol.registerStreamProtocol('media', (request, callback) => {
      try {
        const url = new URL(request.url);
        if (url.hostname !== 'remote') {
          callback({ statusCode: 403 });
          return;
        }
        handleRemote(request, callback, remoteCache);
      } catch {
        callback({ statusCode: 400 });
      }
    });
  }

  createWindow();
  createTray();
  setupAutoUpdater();

  app.on('activate', () => {
    if (!mainWindow) createWindow();
    else showMainWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  // Окно скрывается в трей, поэтому закрытие всех окон не завершает приложение.
  if (isQuitting) app.quit();
});
