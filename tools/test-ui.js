/**
 * Проверка интерфейса: навигация, поиск, альбомы, плейлисты, избранное.
 * Запуск: node tools/test-ui.js
 */

const PORT = process.env.CDP_PORT || 9222;

async function getTarget() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const targets = await res.json();
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) throw new Error('Страница не найдена');
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evaluate(send, expression) {
  const result = await send('Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || 'exception');
  }
  return result.result.value;
}

const TESTS = {
  async альбомы(send) {
    return evaluate(send, `
      document.querySelector('.nav-item[data-view="albums"]').click();
      await new Promise(r => setTimeout(r, 300));
      const cards = [...document.querySelectorAll('.card-title')].map(c => c.textContent);
      return JSON.stringify({ view: 'albums', cards });
    `);
  },

  async исполнители(send) {
    return evaluate(send, `
      document.querySelector('.nav-item[data-view="artists"]').click();
      await new Promise(r => setTimeout(r, 300));
      const cards = [...document.querySelectorAll('.card-title')].map(c => c.textContent);
      return JSON.stringify({ view: 'artists', cards });
    `);
  },

  async поиск(send) {
    return evaluate(send, `
      const input = document.getElementById('search');
      input.value = 'Рассвет';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
      const rows = [...document.querySelectorAll('.track-row .tr-title')].map(t => t.textContent);
      return JSON.stringify({ view: 'search', rows });
    `);
  },

  async сбросПоиска(send) {
    return evaluate(send, `
      document.getElementById('btn-clear-search').click();
      await new Promise(r => setTimeout(r, 300));
      return JSON.stringify({ search: document.getElementById('search').value, heroVisible: !document.getElementById('hero').hidden });
    `);
  },

  async мояМузыка(send) {
    return evaluate(send, `
      document.querySelector('.nav-item[data-view="tracks"]').click();
      await new Promise(r => setTimeout(r, 300));
      return JSON.stringify({ rows: document.querySelectorAll('.track-row').length, hasPlayAll: !!document.getElementById('btn-play-all') });
    `);
  },

  async избранное(send) {
    return evaluate(send, `
      document.querySelector('.nav-item[data-view="tracks"]').click();
      await new Promise(r => setTimeout(r, 200));
      const like = document.querySelector('.track-row .like-btn');
      like.click();
      await new Promise(r => setTimeout(r, 300));
      document.querySelector('.nav-item[data-view="favorites"]').click();
      await new Promise(r => setTimeout(r, 300));
      const favs = [...document.querySelectorAll('.track-row .tr-title')].map(t => t.textContent);
      return JSON.stringify({ view: 'favorites', favs });
    `);
  },

  async создатьПлейлист(send) {
    return evaluate(send, `
      document.getElementById('btn-new-playlist').click();
      await new Promise(r => setTimeout(r, 200));
      const input = document.getElementById('modal-input');
      input.value = 'Мой плейлист';
      document.getElementById('modal-ok').click();
      await new Promise(r => setTimeout(r, 400));
      const side = [...document.querySelectorAll('#playlist-nav .side-label')].map(n => n.textContent);
      return JSON.stringify({ playlists: side, modalHidden: document.getElementById('modal-overlay').hidden });
    `);
  },

  async добавитьВПлейлист(send) {
    return evaluate(send, `
      document.querySelector('.nav-item[data-view="tracks"]').click();
      await new Promise(r => setTimeout(r, 200));
      document.querySelector('.track-row .menu-btn').click();
      await new Promise(r => setTimeout(r, 200));
      const menuItem = [...document.querySelectorAll('.context-menu button')].find(b => b.dataset.action === 'playlist');
      menuItem.click();
      await new Promise(r => setTimeout(r, 400));
      const items = [...document.querySelectorAll('.playlist-picker .side-label')].map(n => n.textContent);
      if (items.length) {
        document.querySelector('.playlist-picker .side-item').click();
        await new Promise(r => setTimeout(r, 400));
      }
      const count = document.querySelector('#playlist-nav .side-count');
      return JSON.stringify({ pickerItems: items, playlistTrackCount: count ? count.textContent : null });
    `);
  },

  async состояниеСохранено(send) {
    return evaluate(send, `
      await new Promise(r => setTimeout(r, 400));
      const saved = await window.player.getState();
      return JSON.stringify({
        folders: saved.folders,
        playlists: saved.playlists.map(p => ({ name: p.name, tracks: p.trackIds.length })),
        favorites: saved.favorites.length
      });
    `);
  },
};

(async () => {
  const target = await getTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  const send = cdp(ws);
  await send('Runtime.enable');

  let failures = 0;
  for (const [name, fn] of Object.entries(TESTS)) {
    try {
      const raw = await fn(send);
      console.log(`✓ ${name}: ${raw}`);
    } catch (err) {
      failures++;
      console.log(`✗ ${name}: ${err.message}`);
    }
  }

  console.log(failures ? `\nПровалено тестов: ${failures}` : '\nВсе тесты пройдены');
  ws.close();
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error('ОШИБКА:', err.message);
  process.exit(1);
});
