/** Ставит трек на паузу в середине — для снимка экрана. */
const PORT = process.env.CDP_PORT || 9222;

async function getTarget() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const targets = await res.json();
  return targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
}

function cdp(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
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
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  const send = cdp(ws);
  await send('Runtime.enable');

  const expr = `(async () => {
    document.querySelector('.nav-item[data-view="tracks"]').click();
    await new Promise(r => setTimeout(r, 300));
    const rows = [...document.querySelectorAll('.track-row')];
    const target = rows.find(r => r.querySelector('.tr-title').textContent.includes('Рассвет')) || rows[0];
    target.click();
    await new Promise(r => setTimeout(r, 1600));
    const a = document.getElementById('audio');
    a.pause();
    a.currentTime = Math.min(2.2, a.duration || 2);
    await new Promise(r => setTimeout(r, 300));
    return JSON.stringify({ title: document.getElementById('np-title').textContent, t: a.currentTime });
  })()`;

  const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  console.log(res.exceptionDetails ? 'EXC' : res.result.value);
  ws.close();
})();
