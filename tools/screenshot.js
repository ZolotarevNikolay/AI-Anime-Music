'use strict';

/**
 * Снимок окна приложения через Chrome DevTools Protocol.
 * В отличие от capture.ps1 снимает именно ту страницу, к которой подключён,
 * поэтому результат всегда соответствует проверяемому состоянию.
 *
 * Запуск: node tools/screenshot.js <путь-к-файлу>
 */

const fs = require('fs');
const path = require('path');

const PORT = process.env.CDP_PORT || 9222;
const OUT = process.argv[2] || path.join(__dirname, 'screenshot.png');

async function getTarget() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const targets = await res.json();
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
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

(async () => {
  const target = await getTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  const send = cdp(ws);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log(`saved ${OUT}`);
  ws.close();
})().catch((err) => {
  console.error('ОШИБКА:', err.message);
  process.exit(1);
});
