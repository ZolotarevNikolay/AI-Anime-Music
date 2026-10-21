'use strict';

const zlib = require('zlib');
const { URL } = require('url');

/**
 * Сетевой клиент главного процесса.
 *
 * Важная деталь: AnimeThemes (как и другие крупные сайты за Cloudflare)
 * проверяет TLS-отпечаток клиента. Обычный Node-модуль https сюда не
 * проходит — приходит 403. А сетевой стек Chromium (net.request)
 * работает штатно, поэтому все запросы идут именно через него.
 *
 * Клиент умеет:
 *  - следовать редиректам;
 *  - распаковывать gzip/deflate;
 *  - ограничивать время ожидания;
 *  - отдавать поток ответа без чтения в память (нужно для проксирования медиа).
 */

const DEFAULT_TIMEOUT = 12000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36';

/**
 * Chromium-стек доступен только внутри Electron. В обычном Node
 * (например, при запуске тестов) используем https как запасной вариант.
 */
function getNet() {
  try {
    // eslint-disable-next-line global-require
    const { net } = require('electron');
    if (net && typeof net.request === 'function') return net;
  } catch {
    /* вне Electron */
  }
  return null;
}

function rawRequestElectron(net, url, options) {
  const {
    method = 'GET',
    headers = {},
    body = null,
    timeout = DEFAULT_TIMEOUT,
    redirects = 0,
  } = options;

  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      reject(new Error('Некорректный URL'));
      return;
    }

    const request = net.request({
      method,
      url: target.toString(),
      redirect: 'manual',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Encoding': 'gzip, deflate',
        ...headers,
      },
    });

    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    request.on('response', (response) => {
      const status = response.statusCode || 0;
      const location = response.headers.location;

      if ([301, 302, 303, 307, 308].includes(status) && location && redirects < 5) {
        response.on('data', () => {});
        response.on('end', () => {
          let next;
          try {
            next = new URL(location, target).toString();
          } catch {
            finish(reject, new Error('Некорректный адрес перенаправления'));
            return;
          }
          rawRequest(next, { ...options, redirects: redirects + 1 }).then(
            (res) => finish(resolve, res),
            (err) => finish(reject, err)
          );
        });
        return;
      }

      finish(resolve, response);
    });

    request.on('error', (err) => finish(reject, err));

    // У net.request из Electron нет setTimeout — ограничиваем время вручную.
    const timer = setTimeout(() => {
      request.abort();
      finish(reject, new Error('Превышено время ожидания ответа'));
    }, timeout);
    if (typeof timer.unref === 'function') timer.unref();

    request.on('response', () => clearTimeout(timer));
    request.on('close', () => clearTimeout(timer));

    if (body) request.write(body);
    request.end();
  });
}

/** Запасной путь для обычного Node: стандартные модули http/https. */
function rawRequestNode(url, options) {
  const {
    method = 'GET',
    headers = {},
    body = null,
    timeout = DEFAULT_TIMEOUT,
    redirects = 0,
  } = options;

  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      reject(new Error('Некорректный URL'));
      return;
    }

    const transport = target.protocol === 'http:' ? require('http') : require('https');
    const req = transport.request(
      target,
      {
        method,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Encoding': 'gzip, deflate',
          ...headers,
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirects < 5) {
          res.resume();
          let next;
          try {
            next = new URL(res.headers.location, target).toString();
          } catch {
            reject(new Error('Некорректный адрес перенаправления'));
            return;
          }
          rawRequest(next, { ...options, redirects: redirects + 1 }).then(resolve, reject);
          return;
        }
        resolve(res);
      }
    );

    req.setTimeout(timeout, () => {
      req.destroy(new Error('Превышено время ожидания ответа'));
    });
    req.on('error', reject);

    if (body) req.write(body);
    req.end();
  });
}

/**
 * Выполняет запрос.
 *
 * Транспорт выбирается явно:
 *  - 'electron' — сетевой стек Chromium. Нужен для GraphQL-API: обычный
 *    Node-модуль https там получает 403 от Cloudflare (проверка TLS-отпечатка);
 *  - 'node' — стандартные http/https. Нужен для медиафайлов: стек Chromium
 *    не отдаёт заголовки Content-Length и Content-Range для ответов 206,
 *    а без них браузер не может вычислить длительность трека и перемотку.
 *  - 'auto' — electron при наличии, иначе node.
 */
function rawRequest(url, options = {}) {
  const transport = options.transport || 'auto';

  if (transport === 'node') return rawRequestNode(url, options);

  const net = getNet();
  if (net) return rawRequestElectron(net, url, options);
  return rawRequestNode(url, options);
}

function decodeBody(buffer, encoding) {
  const enc = String(encoding || '').toLowerCase();
  try {
    if (enc === 'gzip') return zlib.gunzipSync(buffer);
    if (enc === 'deflate') return zlib.inflateSync(buffer);
  } catch {
    return buffer;
  }
  return buffer;
}

/** Запрос с получением тела в виде строки. */
async function fetchText(url, options = {}) {
  const res = await rawRequest(url, options);
  const chunks = [];
  for await (const chunk of res) chunks.push(chunk);
  const buffer = decodeBody(Buffer.concat(chunks), res.headers['content-encoding']);
  return {
    status: res.statusCode || 0,
    headers: res.headers,
    body: buffer.toString('utf8'),
  };
}

/** Запрос с разбором JSON. Бросает ошибку при неуспешном коде ответа. */
async function fetchJson(url, options = {}) {
  const res = await fetchText(url, {
    ...options,
    headers: { Accept: 'application/json', ...(options.headers || {}) },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${res.status}`);
  }
  try {
    return JSON.parse(res.body);
  } catch {
    throw new Error('Ответ сервера не является корректным JSON');
  }
}

/** GraphQL-запрос: тело в формате { query, variables }. */
async function graphql(endpoint, query, variables = {}, options = {}) {
  const payload = JSON.stringify({ query, variables });
  const json = await fetchJson(endpoint, {
    method: 'POST',
    body: payload,
    timeout: options.timeout,
    transport: options.transport || 'electron',
    headers: { 'Content-Type': 'application/json' },
  });
  if (json.errors && json.errors.length) {
    const message = json.errors.map((e) => e.message).join('; ');
    throw new Error(message || 'GraphQL: неизвестная ошибка');
  }
  return json.data;
}

module.exports = { rawRequest, fetchText, fetchJson, graphql };
