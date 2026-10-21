'use strict';

/*
 * Собирает build/icon.ico (мультиразмерный, PNG-сжатый) и build/tray.png
 * из исходного icon.png. Запускается через Electron, потому что nativeImage
 * уже умеет качественно ресемплить иконку без нативных зависимостей.
 */

const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BUILD_DIR = path.join(ROOT, 'build');
const SOURCE = path.join(ROOT, 'icon.png');

function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];
  const blobs = [];

  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    // 256 записывается как 0.
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0; // palette
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    blobs.push(data);
    offset += data.length;
  }

  return Buffer.concat([header, ...entries, ...blobs]);
}

app.whenReady().then(() => {
  const source = nativeImage.createFromPath(SOURCE);
  if (source.isEmpty()) {
    console.error('Не удалось прочитать icon.png');
    app.exit(1);
    return;
  }

  fs.mkdirSync(BUILD_DIR, { recursive: true });

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = sizes.map((size) => ({
    size,
    data: source.resize({ width: size, height: size, quality: 'best' }).toPNG(),
  }));
  fs.writeFileSync(path.join(BUILD_DIR, 'icon.ico'), buildIco(images));

  const tray = source.resize({ width: 32, height: 32, quality: 'best' }).toPNG();
  fs.writeFileSync(path.join(BUILD_DIR, 'tray.png'), tray);

  console.log('Готово: build/icon.ico и build/tray.png');
  app.quit();
});
