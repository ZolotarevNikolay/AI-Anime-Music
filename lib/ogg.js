'use strict';

const { rawRequest } = require('./net');

/**
 * Определение длительности OGG-файла (Vorbis и Opus).
 *
 * Формат OGG: страницы с заголовком «OggS», в котором записана позиция
 * гранулы (granule position) — количество отсчётов до конца потока.
 * Длительность = позиция гранулы / частота дискретизации.
 *
 * Позиция гранулы есть только в последней странице, а частота
 * дискретизации — в первой. Поэтому параллельно запрашиваются начало
 * и конец файла: два Range-запроса вместо последовательных.
 */

const HEAD_SIZE = 4096;
const TAIL_SIZE = 65536;

// Защита от серверов, которые игнорируют Range и присылают файл целиком.
const MAX_READ = TAIL_SIZE * 2;

const OGG_PAGE = Buffer.from('OggS', 'latin1');

/** Разбирает заголовок Content-Range вида «bytes 0-4095/3569638». */
function parseContentRange(value) {
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(String(value || '').trim());
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: Number(match[3]),
  };
}

/** Читает диапазон байт файла. */
function readRange(url, range) {
  return rawRequest(url, {
    method: 'GET',
    headers: { Range: range, 'Accept-Encoding': 'identity' },
    timeout: 20000,
    transport: 'node',
  })
    .then(async (res) => {
      const status = res.statusCode || 0;
      if (status >= 400) {
        res.resume();
        return null;
      }

      const chunks = [];
      let size = 0;
      for await (const chunk of res) {
        chunks.push(chunk);
        size += chunk.length;
        if (size >= MAX_READ) break;
      }

      const contentRange = parseContentRange(res.headers['content-range']);
      return {
        status,
        total: contentRange?.total || Number(res.headers['content-length'] || 0),
        data: Buffer.concat(chunks),
      };
    })
    .catch(() => null);
}

/** Читает частоту дискретизации из первого пакета потока. */
function readSampleRate(buffer) {
  // Opus: частота дискретизации всегда 48000, гранулы считаются в ней же.
  if (buffer.indexOf('OpusHead', 0, 'latin1') >= 0) return 48000;

  // Vorbis: пакет «\x01vorbis», затем версия(4), каналы(1), частота(4).
  const vorbisIndex = buffer.indexOf('vorbis', 0, 'latin1');
  if (vorbisIndex >= 0) {
    const rateOffset = vorbisIndex + 6 + 4 + 1;
    if (rateOffset + 4 <= buffer.length) {
      const rate = buffer.readUInt32LE(rateOffset);
      if (rate > 0) return rate;
    }
  }

  return null;
}

/** Находит последнюю страницу «OggS» с корректной позицией гранулы. */
function readLastGranule(buffer) {
  let searchFrom = buffer.length - OGG_PAGE.length;
  while (searchFrom >= 0) {
    const position = buffer.lastIndexOf(OGG_PAGE, searchFrom);
    if (position < 0) return null;

    // Версия структуры потока всегда 0 — отсекает случайные совпадения.
    if (buffer[position + 4] === 0 && position + 14 <= buffer.length) {
      const granule = buffer.readBigUInt64LE(position + 6);
      // 0xFFFFFFFFFFFFFFFF — страница без позиции (например, служебная).
      if (granule > 0n && granule !== 0xffffffffffffffffn) {
        const value = Number(granule);
        if (Number.isFinite(value) && value > 0) return value;
      }
    }

    searchFrom = position - 1;
  }
  return null;
}

/**
 * Возвращает длительность аудиофайла в секундах.
 * @param {string} url — адрес .ogg/.oga/.opus на сервере
 * @returns {Promise<number|null>}
 */
async function getOggDuration(url) {
  if (!/\.(ogg|oga|opus)(\?|#|$)/i.test(url)) return null;

  const [head, tail] = await Promise.all([
    readRange(url, `bytes=0-${HEAD_SIZE - 1}`),
    readRange(url, `bytes=-${TAIL_SIZE}`),
  ]);
  if (!head || !tail) return null;

  const sampleRate = readSampleRate(head.data);
  if (!sampleRate) return null;

  const granule = readLastGranule(tail.data);
  if (!granule) return null;

  const duration = granule / sampleRate;
  return Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null;
}

module.exports = { getOggDuration };
