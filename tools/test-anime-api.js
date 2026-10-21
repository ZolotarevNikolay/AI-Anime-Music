'use strict';

/**
 * Проверка модуля работы с аниме-базами.
 *
 * Запускается внутри Electron: сетевой стек Chromium обходит проверку
 * Cloudflare, которую не проходит обычный Node.
 *
 * Запуск: npx electron tools/test-anime-api.js
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const {
  searchAnime,
  getAnimeThemes,
  getPopularAnime,
  getAnimeRecommendations,
  getAnimeByGenres,
} = require('../lib/anime');

const OUT = path.join(__dirname, 'anime-api-result.json');

let passed = 0;
let failed = 0;

function check(name, condition, extra = '') {
  if (condition) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

async function run() {
  console.log('\n=== Поиск аниме ===');
  const search = await searchAnime('Naruto');
  check('поиск вернул результаты', search.results.length > 0, `получено ${search.results.length}`);
  check('источники определены', Boolean(search.sources.anilist || search.sources.shikimori), JSON.stringify(search.sources));

  const naruto = search.results.find((a) => a.title.toLowerCase() === 'naruto');
  check('найден именно Naruto', Boolean(naruto), search.results.slice(0, 3).map((a) => a.title).join(', '));
  check('у аниме есть MAL-ID', Boolean(naruto && naruto.malId), `malId=${naruto && naruto.malId}`);
  check('у аниме есть обложка', Boolean(naruto && naruto.cover));
  check('у аниме есть год', Boolean(naruto && naruto.year), `year=${naruto && naruto.year}`);

  console.log('\n=== Популярные аниме ===');
  const popular = await getPopularAnime();
  check('список популярных не пуст', popular.length > 0, `получено ${popular.length}`);
  check('у популярных есть MAL-ID', popular.some((a) => a.malId));

  console.log('\n=== Рекомендации для волны ===');
  const related = await getAnimeRecommendations([naruto.malId]);
  check('рекомендации получены', related.related.length > 0, `получено ${related.related.length}`);
  check('семя найдено в AniList', related.seeds.some((a) => a.malId === naruto.malId));
  check('у рекомендаций есть MAL-ID', related.related.every((a) => a.malId));
  check('рекомендации связаны с исходным аниме', related.related.some((a) => a.seedMalId === naruto.malId));
  check('у рекомендаций есть жанры', related.related.some((a) => a.genres && a.genres.length));

  console.log('\n=== Популярное по жанрам ===');
  const byGenre = await getAnimeByGenres(['Action', 'Adventure']);
  check('жанровый список не пуст', byGenre.length > 0, `получено ${byGenre.length}`);
  check('у жанровых аниме есть MAL-ID', byGenre.every((a) => a.malId));
  check('жанры заполнены', byGenre.some((a) => a.genres && a.genres.length));

  console.log('\n=== Опенинги и эндинги ===');
  const themes = await getAnimeThemes({ malId: naruto.malId, title: naruto.title });
  check('аниме найдено в базе опенингов', themes.found);
  check('треки получены', themes.tracks.length > 0, `получено ${themes.tracks.length}`);

  const ops = themes.tracks.filter((t) => t.themeType === 'OP');
  const eds = themes.tracks.filter((t) => t.themeType === 'ED');
  check('есть опенинги', ops.length > 0, `OP: ${ops.length}`);
  check('есть эндинги', eds.length > 0, `ED: ${eds.length}`);

  const first = themes.tracks[0];
  check('у трека есть название песни', Boolean(first.title), first.title);
  check('у трека есть исполнитель', Boolean(first.artist), first.artist);
  check('у трека есть ссылка на аудио', Boolean(first.audioUrl), first.audioUrl);
  check('у трека есть ссылка на видео', Boolean(first.videoUrl), first.videoUrl);
  check('ссылка на аудио — .ogg', /\.ogg(\?|$)/.test(first.audioUrl || ''), first.audioUrl);
  check('ссылка на видео — .webm', /\.webm(\?|$)/.test(first.videoUrl || ''), first.videoUrl);
  check('идентификатор уникален', themes.tracks.every((t) => t.id), first.id);
  check('идентификаторы не повторяются', new Set(themes.tracks.map((t) => t.id)).size === themes.tracks.length);

  console.log('\n=== Волна: темы без массового определения длительности ===');
  const waveThemes = await getAnimeThemes(
    { malId: 16498, title: 'Shingeki no Kyojin', probeDurations: false },
    { probeDurations: false }
  );
  check('волна получает список тем', waveThemes.found && waveThemes.tracks.length > 0, `треков: ${waveThemes.tracks.length}`);

  console.log('\n=== Поиск по названию (запасной путь) ===');
  const byName = await getAnimeThemes({ title: 'Kimetsu no Yaiba' });
  check('аниме найдено по названию', byName.found);
  check('треки получены по названию', byName.tracks.length > 0, `получено ${byName.tracks.length}`);

  return { passed, failed };
}

app.whenReady().then(async () => {
  let summary = { passed: 0, failed: 1, error: 'неизвестная ошибка' };
  try {
    summary = await run();
  } catch (err) {
    console.error('\nТест упал:', err);
    summary.error = err.message;
  }

  console.log(`\nИтог: ${summary.passed} ok, ${summary.failed} fail\n`);
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2), 'utf8');
  app.exit(summary.failed ? 1 : 0);
});
