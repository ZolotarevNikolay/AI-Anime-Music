'use strict';

/**
 * Чтение метаданных аудиофайлов без внешних зависимостей.
 * Поддерживаемые форматы: MP3 (ID3v1/ID3v2), M4A/MP4 (ilst), FLAC (Vorbis),
 * OGG/Opus (Vorbis comment), WAV (RIFF), WAVE.
 */

const fs = require('fs');
const path = require('path');

const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.flac', '.wav', '.m4a', '.mp4', '.aac', '.ogg', '.oga', '.opus', '.wma', '.aiff', '.aif', '.ape',
]);

const TAG_KEYS = {
  title: ['TIT2', '©nam', 'TITLE'],
  artist: ['TPE1', '©ART', 'ARTIST'],
  album: ['TALB', '©alb', 'ALBUM'],
  year: ['TYER', 'TDRC', 'TDRL', '©day', 'DATE'],
  track: ['TRCK', 'trkn', 'TRACKNUMBER'],
  disc: ['TPOS', 'disk', 'DISCNUMBER'],
  genre: ['TCON', '©gen', 'GENRE'],
};

function isAudioFile(filePath) {
  return AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/** Синхробезопасное целое (ID3v2.4). */
function synchsafe(buf, offset) {
  return (
    ((buf[offset] & 0x7f) << 21) |
    ((buf[offset + 1] & 0x7f) << 14) |
    ((buf[offset + 2] & 0x7f) << 7) |
    (buf[offset + 3] & 0x7f)
  );
}

function decodeTextFrame(data) {
  if (!data || data.length === 0) return null;
  const encoding = data[0];
  let text = '';
  try {
    if (encoding === 0) {
      text = data.subarray(1).toString('latin1');
    } else if (encoding === 1) {
      text = data.subarray(1).toString('utf16le');
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    } else if (encoding === 2) {
      text = data.subarray(1).toString('utf16le');
    } else if (encoding === 3) {
      text = data.subarray(1).toString('utf8');
    } else {
      text = data.subarray(1).toString('utf8');
    }
  } catch {
    return null;
  }
  // Многострочные значения разделены нулями — берём первую строку.
  const clean = text.replace(/\0/g, '').replace(/^\uFEFF/, '').trim();
  return clean.length ? clean : null;
}

function readId3Picture(data) {
  if (!data || data.length < 4) return null;
  const encoding = data[0];
  let pos = 1;
  // MIME-тип
  let mimeEnd = pos;
  while (mimeEnd < data.length && data[mimeEnd] !== 0) mimeEnd++;
  const mime = data.subarray(pos, mimeEnd).toString('latin1') || 'image/jpeg';
  pos = mimeEnd + 1;
  if (pos >= data.length) return null;
  pos++; // тип картинки
  // Описание
  if (encoding === 1 || encoding === 2) {
    while (pos + 1 < data.length && !(data[pos] === 0 && data[pos + 1] === 0)) pos += 2;
    pos += 2;
  } else {
    while (pos < data.length && data[pos] !== 0) pos++;
    pos += 1;
  }
  if (pos >= data.length) return null;
  return { mime, data: data.subarray(pos) };
}

function parseId3v2(buf) {
  const tags = {};
  if (buf.length < 10) return { tags, size: 0 };
  if (buf.toString('latin1', 0, 3) !== 'ID3') return { tags, size: 0 };

  const version = buf[3];
  const flags = buf[5];
  const size = synchsafe(buf, 6);
  let offset = 10;
  const end = Math.min(buf.length, 10 + size);

  // Расширенный заголовок
  if (flags & 0x40 && offset + 4 <= end) {
    offset += version >= 4 ? synchsafe(buf, offset) : buf.readUInt32BE(offset) + 4;
  }

  const unsync = Boolean(flags & 0x80);
  const frames = new Map();

  while (offset + 10 <= end) {
    const id = buf.toString('latin1', offset, offset + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    let frameSize;
    if (version >= 4) {
      frameSize = synchsafe(buf, offset + 4);
    } else {
      frameSize = buf.readUInt32BE(offset + 4);
    }
    const frameFlags = buf.readUInt16BE(offset + 8);
    offset += 10;
    if (frameSize <= 0 || offset + frameSize > end) break;

    let data = buf.subarray(offset, offset + frameSize);
    offset += frameSize;

    if (frameFlags & 0x0001) continue; // сжатый кадр
    if (frameFlags & 0x0002) continue; // зашифрованный кадр
    if (unsync) data = Buffer.from(data.toString('latin1').replace(/\xff\x00/g, '\xff'), 'latin1');

    frames.set(id, data);
  }

  for (const [field, ids] of Object.entries(TAG_KEYS)) {
    for (const id of ids) {
      if (!frames.has(id)) continue;
      const value = decodeTextFrame(frames.get(id));
      if (value) {
        tags[field] = value;
        break;
      }
    }
  }

  if (frames.has('APIC')) {
    const pic = readId3Picture(frames.get('APIC'));
    if (pic) tags.picture = pic;
  } else if (frames.has('PIC')) {
    const pic = readId3Picture(frames.get('PIC'));
    if (pic) tags.picture = pic;
  }

  // Номер трека: "3/12"
  if (tags.track) {
    const num = parseInt(String(tags.track).split('/')[0], 10);
    if (Number.isFinite(num)) tags.trackNumber = num;
  }
  if (tags.disc) {
    const num = parseInt(String(tags.disc).split('/')[0], 10);
    if (Number.isFinite(num)) tags.discNumber = num;
  }
  if (tags.year) {
    const year = parseInt(String(tags.year).slice(0, 4), 10);
    if (Number.isFinite(year)) tags.yearNumber = year;
  }

  return { tags, size: 10 + size };
}

function parseId3v1(buf) {
  const tags = {};
  if (buf.length < 128) return tags;
  const tail = buf.subarray(buf.length - 128);
  if (tail.toString('latin1', 0, 3) !== 'TAG') return tags;
  const field = (start, len) => {
    const raw = tail.toString('latin1', start, start + len);
    const clean = raw.replace(/\0/g, '').trim();
    return clean.length ? clean : null;
  };
  tags.title = field(3, 30);
  tags.artist = field(33, 30);
  tags.album = field(63, 30);
  const year = field(93, 4);
  if (year) tags.year = year;
  return tags;
}

/** Контейнер MP4/M4A: атом moov > udta > meta > ilst. */
function parseMp4(buf) {
  const tags = {};
  const meta = findAtom(buf, 0, buf.length, 'moov');
  if (!meta) return tags;
  const udta = findAtom(buf, meta.start, meta.end, 'udta');
  if (!udta) return tags;
  const metaAtom = findAtom(buf, udta.start, udta.end, 'meta');
  if (!metaAtom) return tags;
  // У meta 4 байта версии/флагов перед дочерними атомами.
  const ilst = findAtom(buf, metaAtom.start + 4, metaAtom.end, 'ilst');
  if (!ilst) return tags;

  let pos = ilst.start;
  while (pos + 8 <= ilst.end) {
    const size = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    if (size < 8) break;
    const itemEnd = Math.min(pos + size, ilst.end);
    const dataAtom = findAtom(buf, pos + 8, itemEnd, 'data');
    if (dataAtom) {
      const value = buf.subarray(dataAtom.start + 8, dataAtom.end);
      switch (type) {
        case '\u00a9nam': tags.title = value.toString('utf8'); break;
        case '\u00a9ART': tags.artist = value.toString('utf8'); break;
        case '\u00a9alb': tags.album = value.toString('utf8'); break;
        case '\u00a9day': tags.year = value.toString('utf8'); break;
        case '\u00a9gen': tags.genre = value.toString('utf8'); break;
        case 'trkn': {
          if (value.length >= 4) tags.trackNumber = value.readUInt16BE(2);
          break;
        }
        case 'disk': {
          if (value.length >= 4) tags.discNumber = value.readUInt16BE(2);
          break;
        }
        case 'covr': {
          const mime = value.readUInt32BE(0) === 14 ? 'image/png' : 'image/jpeg';
          tags.picture = { mime, data: value.subarray(4) };
          break;
        }
        default: break;
      }
    }
    pos += size;
  }
  return tags;
}

function findAtom(buf, start, end, name) {
  let pos = start;
  while (pos + 8 <= end) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    let headerSize = 8;
    if (size === 1) {
      if (pos + 16 > end) return null;
      size = Number(buf.readBigUInt64BE(pos + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < headerSize) return null;
    if (type === name) {
      return { start: pos + headerSize, end: Math.min(pos + size, end) };
    }
    pos += size;
  }
  return null;
}

/** FLAC: STREAMINFO (длительность) + VORBIS_COMMENT + PICTURE. */
function parseFlac(buf) {
  const tags = {};
  if (buf.length < 8 || buf.toString('latin1', 0, 4) !== 'fLaC') return { tags, duration: null };

  let pos = 4;
  let duration = null;
  let commentBlock = null;
  let pictureBlock = null;

  while (pos + 4 <= buf.length) {
    const header = buf[pos];
    const isLast = Boolean(header & 0x80);
    const type = header & 0x7f;
    const length = (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3];
    const bodyStart = pos + 4;
    const bodyEnd = Math.min(bodyStart + length, buf.length);
    if (bodyStart > buf.length) break;

    if (type === 0 && bodyEnd - bodyStart >= 18) {
      const sampleRate = (buf.readUInt32BE(bodyStart + 10) >>> 12) & 0x0fffff;
      const totalSamples =
        ((buf.readUInt32BE(bodyStart + 13) & 0x0f) * 2 ** 32) + buf.readUInt32BE(bodyStart + 14);
      if (sampleRate > 0) duration = totalSamples / sampleRate;
    } else if (type === 4) {
      commentBlock = buf.subarray(bodyStart, bodyEnd);
    } else if (type === 6) {
      pictureBlock = buf.subarray(bodyStart, bodyEnd);
    }
    pos = bodyEnd;
    if (isLast) break;
  }

  if (commentBlock) {
    const vorbis = parseVorbisComment(commentBlock);
    Object.assign(tags, vorbis);
  }
  if (pictureBlock) {
    const pic = parseFlacPicture(pictureBlock);
    if (pic) tags.picture = pic;
  }
  return { tags, duration };
}

function parseFlacPicture(block) {
  try {
    let pos = 4; // тип картинки
    const mimeLen = block.readUInt32BE(pos); pos += 4;
    const mime = block.subarray(pos, pos + mimeLen).toString('latin1'); pos += mimeLen;
    const descLen = block.readUInt32BE(pos); pos += 4 + descLen;
    pos += 16; // ширина, высота, глубина, цвета
    const dataLen = block.readUInt32BE(pos); pos += 4;
    if (pos + dataLen > block.length) return null;
    return { mime: mime || 'image/jpeg', data: block.subarray(pos, pos + dataLen) };
  } catch {
    return null;
  }
}

function parseVorbisComment(block) {
  const tags = {};
  try {
    let pos = 0;
    const vendorLen = block.readUInt32LE(pos); pos += 4 + vendorLen;
    const count = block.readUInt32LE(pos); pos += 4;
    const map = {
      TITLE: 'title', ARTIST: 'artist', ALBUM: 'album', DATE: 'year',
      TRACKNUMBER: 'track', DISCNUMBER: 'disc', GENRE: 'genre',
    };
    for (let i = 0; i < count; i++) {
      if (pos + 4 > block.length) break;
      const len = block.readUInt32LE(pos); pos += 4;
      const comment = block.subarray(pos, pos + len).toString('utf8');
      pos += len;
      const eq = comment.indexOf('=');
      if (eq < 0) continue;
      const key = comment.slice(0, eq).toUpperCase();
      const value = comment.slice(eq + 1);
      if (map[key] && !tags[map[key]]) tags[map[key]] = value;
      if (key === 'METADATA_BLOCK_PICTURE' && !tags.picture) {
        const decoded = Buffer.from(value, 'base64');
        const pic = parseFlacPicture(decoded);
        if (pic) tags.picture = pic;
      }
    }
  } catch {
    /* повреждённый блок — пропускаем */
  }
  if (tags.track) {
    const n = parseInt(String(tags.track).split('/')[0], 10);
    if (Number.isFinite(n)) tags.trackNumber = n;
  }
  if (tags.year) {
    const y = parseInt(String(tags.year).slice(0, 4), 10);
    if (Number.isFinite(y)) tags.yearNumber = y;
  }
  return tags;
}

/** OGG/Opus: ищем Vorbis-комментарий и картинку в потоке страниц. */
function parseOgg(buf) {
  const tags = {};
  const text = buf.toString('latin1');
  const commentIdx = text.indexOf('\x03vorbis');
  if (commentIdx > 0) {
    const block = buf.subarray(commentIdx + 7);
    Object.assign(tags, parseVorbisComment(block));
  }
  const opusIdx = text.indexOf('OpusTags');
  if (opusIdx > 0 && !tags.title) {
    const block = buf.subarray(opusIdx + 8);
    Object.assign(tags, parseVorbisComment(block));
  }
  return tags;
}

/** WAV: длительность из заголовков RIFF. */
function parseWav(buf) {
  const tags = {};
  let duration = null;
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF') return { tags, duration };
  const isWave = buf.toString('latin1', 8, 12) === 'WAVE';
  if (!isWave) return { tags, duration };
  let pos = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('latin1', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ' && body + 16 <= buf.length) {
      byteRate = buf.readUInt32LE(body + 8);
    } else if (id === 'data') {
      dataSize = size;
    }
    pos = body + size + (size % 2);
  }
  if (byteRate > 0 && dataSize > 0) duration = dataSize / byteRate;
  return { tags, duration };
}

/** Длительность MP3 по Xing/Info-заголовку или по битрейту. */
function parseMp3Duration(buf, id3Size, fileSize) {
  try {
    const offset = id3Size;
    if (offset + 4 > buf.length) return null;

    // Xing / Info
    const xingIdx = buf.indexOf('Xing', offset, 'latin1');
    const infoIdx = buf.indexOf('Info', offset, 'latin1');
    const tagPos = xingIdx >= 0 ? xingIdx : infoIdx;
    if (tagPos >= 0 && tagPos + 12 <= buf.length) {
      const flags = buf.readUInt32BE(tagPos + 4);
      let pos = tagPos + 8;
      let frames = 0;
      if (flags & 0x0001) {
        frames = buf.readUInt32BE(pos);
        pos += 4;
      }
      if (flags & 0x0002) pos += 4; // байты
      if (flags & 0x0004) pos += 100; // TOC
      if (flags & 0x0008) pos += 4; // quality

      if (frames > 0) {
        // Найти MPEG-версию из заголовка фрейма перед XING.
        const headerPos = findMpegFrameHeader(buf, Math.max(0, tagPos - 4));
        const header = headerPos >= 0 ? parseMpegHeader(buf, headerPos) : null;
        if (header) {
          return (frames * header.samplesPerFrame) / header.sampleRate;
        }
      }
    }

    // Иначе — приблизительно по битрейту первого фрейма.
    const headerPos = findMpegFrameHeader(buf, offset);
    if (headerPos < 0) return null;
    const header = parseMpegHeader(buf, headerPos);
    if (!header || !header.bitrate) return null;
    const audioBytes = fileSize - headerPos;
    return (audioBytes * 8) / header.bitrate;
  } catch {
    return null;
  }
}

function findMpegFrameHeader(buf, from) {
  for (let i = from; i < buf.length - 4 && i < from + 65536; i++) {
    if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) {
      if (parseMpegHeader(buf, i)) return i;
    }
  }
  return -1;
}

function parseMpegHeader(buf, pos) {
  if (pos + 4 > buf.length) return null;
  if (buf[pos] !== 0xff || (buf[pos + 1] & 0xe0) !== 0xe0) return null;
  const versionBits = (buf[pos + 1] >> 3) & 0x03;
  const layerBits = (buf[pos + 1] >> 1) & 0x03;
  if (versionBits === 0x01 || layerBits === 0x00) return null;

  const bitrateIndex = (buf[pos + 2] >> 4) & 0x0f;
  const sampleIndex = (buf[pos + 2] >> 2) & 0x03;
  if (bitrateIndex === 0 || bitrateIndex === 0x0f || sampleIndex === 0x03) return null;

  const version = versionBits === 0x03 ? 1 : versionBits === 0x02 ? 2 : 2.5;
  const layer = 4 - layerBits; // 1, 2, 3
  const sampleRates = {
    1: [44100, 48000, 32000],
    2: [22050, 24000, 16000],
    2.5: [11025, 12000, 8000],
  };
  const sampleRate = sampleRates[version][sampleIndex];
  const bitrateTables = {
    1: { 1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0], 2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0], 3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0] },
    2: { 1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0], 3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0] },
  };
  const table = bitrateTables[version];
  if (!table) return null;
  const bitrate = table[layer][bitrateIndex];
  if (!bitrate) return null;

  // Сэмплов на кадр: Layer I — 384, Layer II — 1152,
  // Layer III — 1152 для MPEG-1 и 576 для MPEG-2/2.5.
  let samplesPerFrame;
  if (layer === 1) samplesPerFrame = 384;
  else if (layer === 2) samplesPerFrame = 1152;
  else samplesPerFrame = version === 1 ? 1152 : 576;

  return { version, layer, bitrate: bitrate * 1000, sampleRate, samplesPerFrame };
}

/**
 * Читает метаданные файла.
 * @returns {{tags: object, duration: number|null}}
 */
function readMetadata(filePath) {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const ext = path.extname(filePath).toLowerCase();

  let tags = {};
  let duration = null;

  const headSize = Math.min(fileSize, 1024 * 512);
  const fd = fs.openSync(filePath, 'r');
  let head;
  try {
    head = Buffer.alloc(headSize);
    fs.readSync(fd, head, 0, headSize, 0);
  } finally {
    fs.closeSync(fd);
  }

  if (ext === '.flac') {
    const result = parseFlac(head);
    tags = result.tags;
    duration = result.duration;
  } else if (ext === '.wav' || ext === '.aiff' || ext === '.aif') {
    const result = parseWav(head);
    tags = result.tags;
    duration = result.duration;
  } else if (ext === '.m4a' || ext === '.mp4' || ext === '.aac') {
    tags = parseMp4(head);
  } else if (ext === '.ogg' || ext === '.oga' || ext === '.opus') {
    tags = parseOgg(head);
  } else {
    // MP3 и прочее: ID3v2 в начале, ID3v1 в конце.
    const id3 = parseId3v2(head);
    tags = id3.tags;
    if (Object.keys(tags).length === 0 && fileSize > 128) {
      const tailFd = fs.openSync(filePath, 'r');
      try {
        const tail = Buffer.alloc(128);
        fs.readSync(tailFd, tail, 0, 128, fileSize - 128);
        Object.assign(tags, parseId3v1(tail));
      } finally {
        fs.closeSync(tailFd);
      }
    }
    duration = parseMp3Duration(head, id3.size, fileSize);
    if (!duration) duration = null;
  }

  return { tags, duration, size: fileSize };
}

module.exports = { readMetadata, isAudioFile, AUDIO_EXTENSIONS };
