/**
 * Проверка воспроизведения через Chrome DevTools Protocol.
 * Запуск: node tools/test-playback.js
 */

const PORT = process.env.CDP_PORT || 9222;

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

const EXPRESSION = `(async () => {
  const row = document.querySelector('.track-row');
  if (!row) return JSON.stringify({ error: 'нет строк треков' });
  row.click();
  await new Promise((r) => setTimeout(r, 2000));
  const a = document.getElementById('audio');
  return JSON.stringify({
    title: document.getElementById('np-title').textContent,
    artist: document.getElementById('np-artist').textContent,
    src: a.currentSrc || a.src,
    paused: a.paused,
    currentTime: Number(a.currentTime.toFixed(2)),
    duration: Number.isFinite(a.duration) ? Number(a.duration.toFixed(2)) : a.duration,
    readyState: a.readyState,
    networkState: a.networkState,
    mediaError: a.error ? a.error.code : null,
    playBtnIcon: document.getElementById('play-icon') ? 'present' : 'swapped'
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

  const result = await send('Runtime.evaluate', {
    expression: EXPRESSION,
    awaitPromise: true,
    returnByValue: true,
  });

  console.log(JSON.stringify(JSON.parse(result.result.value), null, 2));
  ws.close();
})().catch((err) => {
  console.error('ОШИБКА:', err.message);
  process.exit(1);
});
