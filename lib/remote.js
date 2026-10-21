'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PassThrough } = require('stream');
const { URL } = require('url');

const { rawRequest } = require('./net');

/**
 * Проксирование удалённых медиа через собственный протокол media://remote/…
 *
 * Зачем это нужно:
 *  - CSP приложения остаётся строгим (разрешён только свой протокол);
 *  - файл скачивается один раз и дальше отдаётся с диска (мгновенный повтор);
 *  - поддерживается перемотка: Range-запросы пробрасываются на сервер.
 *
 * Формат адреса: media://remote/<base64url(исходный https-адрес)>
 */

/** Разрешённые хосты: всё, что не входит в список, отклоняется. */
const ALLOWED_HOSTS = [
  'a.animethemes.moe',
  'v.animethemes.moe',
  'animethemes.moe',
  'r2.dev',
  'anilist.co',
  'myanimelist.net',
  'shikimori.one',
];

const MIME_BY_EXT = {
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.avif': 'image/avif',
  '.webp': 'image/webp',
};

function isAllowed(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

/** Кодирует внешний адрес в короткий токен для media://remote/… */
function encodeRemote(rawUrl) {
  return Buffer.from(String(rawUrl), 'utf8').toString('base64url');
}

/** Обратное преобразование токена в адрес. */
function decodeRemote(token) {
  try {
    return Buffer.from(String(token), 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

/** Публичный адрес для вставки в <audio> или <video>. */
function remoteUrl(rawUrl) {
  return `media://remote/${encodeRemote(rawUrl)}`;
}

/* ------------------------------------------------------------------ */
/*  Кэш на диске                                                        */
/* ------------------------------------------------------------------ */

class RemoteCache {
  constructor(dir) {
    this.dir = dir;
    /** Адреса, которые уже качаются в фоне. */
    this.pending = new Map();
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      /* каталог создастся при первой записи */
    }
    this.cleanupPartials();
  }

  /** Убирает незавершённые загрузки: они никогда не будут использованы. */
  cleanupPartials() {
    try {
      for (const name of fs.readdirSync(this.dir)) {
        if (!name.endsWith('.part')) continue;
        const full = path.join(this.dir, name);
        const stat = fs.statSync(full);
        // Молчащий файл час — прерванная загрузка.
        if (Date.now() - stat.mtimeMs > 60 * 60 * 1000) {
          fs.unlinkSync(full);
        }
      }
    } catch {
      /* каталог мог не создаться — не критично */
    }
  }

  keyFor(rawUrl) {
    const hash = crypto.createHash('sha1').update(rawUrl).digest('hex');
    const ext = path.extname(new URL(rawUrl).pathname).toLowerCase() || '.bin';
    return {
      hash,
      file: path.join(this.dir, `${hash}${ext}`),
      part: path.join(this.dir, `${hash}${ext}.part`),
    };
  }

  has(rawUrl) {
    const { file } = this.keyFor(rawUrl);
    try {
      return fs.statSync(file).size > 0;
    } catch {
      return false;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Разбор Range                                                        */
/* ------------------------------------------------------------------ */

function parseRange(header, totalSize) {
  if (!header || !totalSize) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match) return null;

  const [, startRaw, endRaw] = match;
  let start;
  let end;

  if (startRaw === '') {
    // bytes=-N — последние N байт.
    const length = Number(endRaw);
    if (!Number.isFinite(length) || length <= 0) return null;
    start = Math.max(0, totalSize - length);
    end = totalSize - 1;
  } else {
    start = Number(startRaw);
    end = endRaw === '' ? totalSize - 1 : Number(endRaw);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= totalSize) {
    return null;
  }
  return { start, end: Math.min(end, totalSize - 1) };
}

/* ------------------------------------------------------------------ */
/*  Отдача локального файла с поддержкой Range                          */
/* ------------------------------------------------------------------ */

function serveFile(filePath, request, callback) {
  let total = 0;
  try {
    total = fs.statSync(filePath).size;
  } catch {
    callback({ statusCode: 404 });
    return;
  }

  const range = parseRange(request.headers?.range, total);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_BY_EXT[ext] || 'application/octet-stream';

  if (request.headers?.range && !range) {
    callback({
      statusCode: 416,
      headers: { 'Content-Range': `bytes */${total}` },
    });
    return;
  }

  if (range) {
    callback({
      statusCode: 206,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(range.end - range.start + 1),
        'Content-Range': `bytes ${range.start}-${range.end}/${total}`,
        'Accept-Ranges': 'bytes',
      },
      data: fs.createReadStream(filePath, { start: range.start, end: range.end }),
    });
    return;
  }

  callback({
    statusCode: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(total),
      'Accept-Ranges': 'bytes',
    },
    data: fs.createReadStream(filePath),
  });
}

/* ------------------------------------------------------------------ */
/*  Скачивание и одновременная отдача                                   */
/* ------------------------------------------------------------------ */

/** Максимальный размер файла, который имеет смысл хранить на диске. */
const MAX_CACHE_SIZE = 80 * 1024 * 1024;

/**
 * Скачивает файл целиком в фоне и складывает его в кэш.
 *
 * Запрос отдельный от клиентского: браузер закрывает соединение, как
 * только ему хватило данных, — через него файл целиком не скачается.
 */
function downloadToCache(rawUrl, cache) {
  const key = cache.keyFor(rawUrl);
  if (cache.pending.has(rawUrl)) return cache.pending.get(rawUrl);

  const promise = rawRequest(rawUrl, {
    method: 'GET',
    headers: { 'Accept-Encoding': 'identity' },
    timeout: 120000,
    transport: 'node',
  })
    .then((res) => {
      const status = res.statusCode || 0;
      if (status !== 200) {
        res.resume();
        return false;
      }
      const total = Number(res.headers['content-length'] || 0);
      if (!total || total > MAX_CACHE_SIZE) {
        res.resume();
        return false;
      }

      return new Promise((resolve) => {
        const file = fs.createWriteStream(key.part);
        let written = 0;

        res.on('data', (chunk) => {
          written += chunk.length;
          file.write(chunk);
        });
        res.on('end', () => {
          file.end(() => {
            if (written < total) {
              try { fs.unlinkSync(key.part); } catch { /* не критично */ }
              resolve(false);
              return;
            }
            try {
              fs.renameSync(key.part, key.file);
              resolve(true);
            } catch {
              resolve(false);
            }
          });
        });
        res.on('error', () => {
          file.destroy();
          try { fs.unlinkSync(key.part); } catch { /* не критично */ }
          resolve(false);
        });
      });
    })
    .catch(() => false)
    .finally(() => cache.pending.delete(rawUrl));

  cache.pending.set(rawUrl, promise);
  return promise;
}

/**
 * Отдаёт файл с сервера, поддерживая Range-запросы.
 *
 * Запрос идёт через стандартный Node-транспорт: сетевой стек Chromium
 * не отдаёт заголовки Content-Length и Content-Range для ответов 206,
 * а без них браузер не может вычислить длительность трека и перемотка
 * работать не будет.
 */
function serveFromNetwork(rawUrl, rangeHeader, cache) {
  const headers = { 'Accept-Encoding': 'identity' };
  if (rangeHeader) headers.Range = rangeHeader;

  return rawRequest(rawUrl, {
    method: 'GET',
    headers,
    timeout: 60000,
    transport: 'node',
  }).then((res) => {
    const status = res.statusCode || 502;
    if (status >= 400) {
      res.resume();
      return { statusCode: status >= 500 ? 502 : status, headers: {}, stream: null };
    }

    const outHeaders = {
      'Content-Type': res.headers['content-type'] || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
    };
    if (res.headers['content-range']) outHeaders['Content-Range'] = res.headers['content-range'];
    if (res.headers['content-length']) outHeaders['Content-Length'] = res.headers['content-length'];

    // Файл приходит целиком — складываем его в кэш.
    // Частичный ответ тоже подходит, если он покрывает файл целиком
    // (браузер обычно просит «bytes=0-»).
    const total = Number(res.headers['content-length'] || 0);
    const contentRange = res.headers['content-range'] || '';
    const rangeMatch = /^bytes\s+(\d+)-(\d+)\/(\d+)$/.exec(contentRange);
    const coversWholeFile = status === 200
      || (status === 206 && rangeMatch && rangeMatch[1] === '0' && total === Number(rangeMatch[3]));
    const cacheable = Boolean(cache) && coversWholeFile && total > 0 && total <= MAX_CACHE_SIZE;

    const pass = new PassThrough();

    if (cacheable) {
      // Браузер закрывает соединение, как только ему хватило данных для
      // воспроизведения, — через этот поток файл целиком не скачается.
      // Поэтому копию для кэша качаем отдельным запросом.
      downloadToCache(rawUrl, cache);
    }

    res.on('error', () => pass.destroy());
    res.pipe(pass);

    return { statusCode: status === 206 ? 206 : 200, headers: outHeaders, stream: pass };
  }).catch((err) => {
    console.warn('Не удалось получить удалённый файл:', err.message);
    return { statusCode: 502, headers: {}, stream: null };
  });
}

/**
 * Разбирает адрес вида media://remote/<token> и готовит ответ.
 *
 * Файл из кэша отдаётся с точной длиной и поддержкой Range — с ним
 * работает перемотка. Файл, которого в кэше ещё нет, скачивается целиком.
 *
 * @returns {Promise<{statusCode:number, headers:object, stream:object|null}>}
 */
function resolveRemote(token, rangeHeader, cache) {
  const rawUrl = decodeRemote(token);
  if (!rawUrl || !isAllowed(rawUrl)) {
    return Promise.resolve({ statusCode: 403, headers: {}, stream: null });
  }

  if (cache && cache.has(rawUrl)) {
    return new Promise((resolve) => {
      serveFile(cache.keyFor(rawUrl).file, { headers: { range: rangeHeader } }, (response) => {
        resolve({
          statusCode: response.statusCode || 200,
          headers: response.headers || {},
          stream: response.data || null,
        });
      });
    });
  }

  // Файла ещё нет в кэше: отдаём его из сети с поддержкой Range.
  return serveFromNetwork(rawUrl, rangeHeader, cache);
}

/** Извлекает токен из адреса media://remote/<token>. */
function extractToken(requestUrl) {
  try {
    const url = new URL(requestUrl);
    return decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  } catch {
    return null;
  }
}

/**
 * Обработчик для потокового протокола (Electron 20–24).
 */
function handleRemote(request, callback, cache) {
  const token = extractToken(request.url);
  if (!token) {
    callback({ statusCode: 400 });
    return;
  }
  const rangeHeader = request.headers?.range || request.headers?.Range || null;
  resolveRemote(token, rangeHeader, cache).then((response) => {
    callback({
      statusCode: response.statusCode,
      headers: response.headers,
      data: response.stream || undefined,
    });
  });
}

module.exports = { RemoteCache, remoteUrl, handleRemote, resolveRemote, extractToken, isAllowed };
