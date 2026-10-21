'use strict';

/**
 * Выполняет выражение в запущенном приложении через CDP.
 *
 * Запуск: node tools/cdp-eval.js "выражение"
 * Приложение должно быть запущено с --remote-debugging-port=9222.
 */

const PORT = process.env.CDP_PORT || 9222;

async function getTarget() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const targets = await res.json();
  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  const page = pages.find((t) => /^file:\/\//i.test(t.url || '')) || pages[0];
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
  const expression = process.argv.slice(2).join(' ');
  if (!expression) throw new Error('Не задано выражение');
  const target = await getTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  const send = cdp(ws);
  await send('Runtime.enable');
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    console.error(result.exceptionDetails.exception?.description || 'Ошибка выполнения');
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(result.result.value, null, 2));
  }
  ws.close();
})().catch((err) => {
  console.error('ОШИБКА:', err.message);
  process.exit(1);
});
