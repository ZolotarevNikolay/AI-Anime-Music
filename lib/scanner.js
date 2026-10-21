'use strict';

const fs = require('fs');
const path = require('path');
const { readMetadata, isAudioFile } = require('./metadata');

const IGNORED_DIRS = new Set(['node_modules', '.git', '.svn', '$RECYCLE.BIN', 'System Volume Information']);

/**
 * Рекурсивно обходит папку и собирает список аудиофайлов.
 * @param {string} rootDir
 * @param {{onProgress?: Function, signal?: {cancelled: boolean}}} options
 */
function scanFolder(rootDir, options = {}) {
  const { onProgress, signal } = options;
  const tracks = [];
  const errors = [];
  const root = path.resolve(rootDir);

  if (!fs.existsSync(root)) {
    return { tracks, errors: [{ path: root, message: 'Папка не найдена' }], scannedFiles: 0 };
  }

  let scannedFiles = 0;

  const walk = (dir, depth) => {
    if (signal?.cancelled) return;
    if (depth > 12) return;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      errors.push({ path: dir, message: err.message });
      return;
    }

    for (const entry of entries) {
      if (signal?.cancelled) return;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;
        walk(full, depth + 1);
        continue;
      }

      if (!entry.isFile()) continue;
      if (!isAudioFile(full)) continue;

      try {
        const stat = fs.statSync(full);
        const { tags, duration } = readMetadata(full);
        scannedFiles++;

        tracks.push({
          id: full,
          path: full,
          fileName: entry.name,
          folder: path.relative(root, dir) || '.',
          root,
          size: stat.size,
          mtime: stat.mtimeMs,
          title: tags.title || path.parse(entry.name).name,
          artist: tags.artist || 'Неизвестный исполнитель',
          album: tags.album || 'Без альбома',
          albumArtist: tags.albumArtist || null,
          year: tags.yearNumber || (tags.year ? parseInt(String(tags.year).slice(0, 4), 10) || null : null),
          trackNumber: tags.trackNumber || null,
          discNumber: tags.discNumber || null,
          genre: tags.genre || null,
          duration: duration ? Math.round(duration) : null,
          hasCover: Boolean(tags.picture),
        });

        if (onProgress && scannedFiles % 25 === 0) {
          onProgress({ scannedFiles, current: full });
        }
      } catch (err) {
        errors.push({ path: full, message: err.message });
      }
    }
  };

  walk(root, 0);

  tracks.sort((a, b) => {
    if (a.artist !== b.artist) return a.artist.localeCompare(b.artist, 'ru');
    if (a.album !== b.album) return a.album.localeCompare(b.album, 'ru');
    const at = a.trackNumber ?? Number.MAX_SAFE_INTEGER;
    const bt = b.trackNumber ?? Number.MAX_SAFE_INTEGER;
    if (at !== bt) return at - bt;
    return a.title.localeCompare(b.title, 'ru');
  });

  return { tracks, errors, scannedFiles };
}

module.exports = { scanFolder };
