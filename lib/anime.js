'use strict';

const { graphql, fetchJson } = require('./net');
const { getOggDuration } = require('./ogg');

/**
 * Работа с базами аниме: поиск и списки опенингов/эндингов.
 *
 * Источники:
 *  - AniList   (graphql.anilist.co)      — поиск, обложки, рейтинг, MAL-ID.
 *  - Shikimori (shikimori.one/api)        — поиск по русским названиям (может быть недоступен).
 *  - AnimeThemes (graphql.animethemes.moe) — сами OP/ED: песня, исполнитель, аудио и видео.
 *
 * Связка между ними — MAL-ID: AniList и Shikimori его отдают, AnimeThemes
 * ищет по нему через findAnimeByExternalSite.
 */

const ANILIST_API = 'https://graphql.anilist.co';
const THEMES_API = 'https://graphql.animethemes.moe/';
const SHIKIMORI_API = 'https://shikimori.one/api';

const ANILIST_SEARCH = `
query ($search: String, $page: Int) {
  Page(page: $page, perPage: 20) {
    media(search: $search, type: ANIME, sort: [POPULARITY_DESC]) {
      id
      idMal
      title { romaji english native }
      coverImage { large }
      averageScore
      format
      seasonYear
      episodes
      genres
      description(asHtml: false)
    }
  }
}`;

const THEMES_QUERY = `
query ($link: String) {
  findAnimeByExternalSite(site: MAL, link: $link) {
    id
    slug
    title { romaji english native }
    synopsis
    year
    images { nodes { link } }
    animethemes {
      type
      sequence
      song {
        title { romaji native }
        performances { as artist { name { main } } }
      }
      animethemeentries {
        version
        nsfw
        spoiler
        episodes
        videos {
          nodes {
            link
            resolution
            lyrics
            audio { link mimetype }
          }
        }
      }
    }
  }
}`;

const ANILIST_POPULAR = `
query {
  Page(page: 1, perPage: 24) {
    media(type: ANIME, sort: [TRENDING_DESC, POPULARITY_DESC]) {
      id
      idMal
      title { romaji english native }
      coverImage { large }
      averageScore
      format
      seasonYear
      episodes
      genres
      description(asHtml: false)
    }
  }
}`;

const ANILIST_RECOMMENDATIONS = `
query ($ids: [Int]) {
  Page(page: 1, perPage: 25) {
    media(idMal_in: $ids, type: ANIME) {
      id
      idMal
      title { romaji english native }
      coverImage { large }
      averageScore
      format
      seasonYear
      episodes
      genres
      description(asHtml: false)
      recommendations(sort: [RATING_DESC], perPage: 12) {
        nodes {
          rating
          mediaRecommendation {
            id
            idMal
            title { romaji english native }
            coverImage { large }
            averageScore
            format
            seasonYear
            episodes
            genres
            description(asHtml: false)
          }
        }
      }
    }
  }
}`;

const ANILIST_BY_GENRES = `
query ($genres: [String]) {
  Page(page: 1, perPage: 20) {
    media(type: ANIME, genre_in: $genres, sort: [POPULARITY_DESC]) {
      id
      idMal
      title { romaji english native }
      coverImage { large }
      averageScore
      format
      seasonYear
      episodes
      genres
      description(asHtml: false)
    }
  }
}`;

/**
 * Большая выборка для «Моей волны». В отличие от списка популярного,
 * здесь есть страницы и фильтр по году: так можно уходить вглубь каталога,
 * а не крутиться вокруг первых 20–40 тайтлов.
 */
const ANILIST_EXPLORE = `
query ($page: Int, $perPage: Int, $genres: [String], $year: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage total }
    media(
      type: ANIME
      genre_in: $genres
      seasonYear: $year
      sort: [POPULARITY_DESC]
      isAdult: false
    ) {
      id
      idMal
      title { romaji english native }
      coverImage { large }
      averageScore
      format
      seasonYear
      episodes
      genres
      description(asHtml: false)
    }
  }
}`;

const THEMES_SEARCH = `
query ($search: String) {
  animePagination(search: $search, first: 10) {
    data {
      id
      slug
      title { romaji english native }
      year
      synopsis
      images { nodes { link } }
      resources { nodes { site id link } }
    }
  }
}`;

/* ------------------------------------------------------------------ */
/*  Кэш в памяти: защита от лишних запросов к API                      */
/* ------------------------------------------------------------------ */

const memoryCache = new Map();
const MEMORY_TTL = 5 * 60 * 1000;

/** Shikimori может лежать — запоминаем это, чтобы не долбить сайт. */
const shikimoriState = { down: false, since: 0 };
const SHIKIMORI_RETRY = 10 * 60 * 1000;

function cacheGet(key) {
  const hit = memoryCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > MEMORY_TTL) {
    memoryCache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  memoryCache.set(key, { at: Date.now(), value });
  return value;
}

/* ------------------------------------------------------------------ */
/*  Нормализация                                                        */
/* ------------------------------------------------------------------ */

function cleanText(value) {
  if (!value) return '';
  return String(value)
    // AniList иногда присылает описание с HTML-тегами.
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function pickMalId(source) {
  if (!source || typeof source !== 'object') return null;
  const candidates = [
    source.myanimelist_id,
    source.myanimelistId,
    source.mal_id,
    source.malId,
    source.idMal,
    source.id_mal,
  ];
  for (const value of candidates) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return null;
}

/** Выбирает обложку из списка AnimeThemes: сначала большую. */
function pickCover(nodes) {
  const large = nodes.find((node) => /large/i.test(node.link || ''));
  return (large || nodes[0])?.link || '';
}

/** Приводит любой ответ источника к общему виду карточки аниме. */
function normalizeAnime(raw, source) {
  if (!raw) return null;

  const title = cleanText(
    raw.title?.romaji || raw.title?.english || raw.name || raw.title?.main
  );
  if (!title) return null;

  const titleEn = cleanText(raw.title?.english || raw.english);
  const titleRu = cleanText(raw.russian);
  const titleNative = cleanText(raw.title?.native || raw.japanese);

  const cover =
    raw.coverImage?.large ||
    raw.image?.original ||
    raw.image?.preview ||
    raw.cover?.original ||
    // AnimeThemes отдаёт обложки списком: приоритет у большой.
    (Array.isArray(raw.images?.nodes) ? pickCover(raw.images.nodes) : '') ||
    '';

  const score = Number.isFinite(raw.averageScore)
    ? raw.averageScore
    : Number.isFinite(raw.score)
      ? raw.score
      : null;

  const year = Number.isFinite(raw.seasonYear)
    ? raw.seasonYear
    : raw.released_on
      ? new Date(raw.released_on).getFullYear()
      : Number.isFinite(raw.year)
        ? raw.year
        : null;

  return {
    id: `${source}:${raw.id ?? title}`,
    source,
    malId: pickMalId(raw),
    title,
    titleEn: titleEn || '',
    titleRu: titleRu || '',
    titleNative: titleNative || '',
    cover,
    score,
    year: year || null,
    format: cleanText(raw.format) || '',
    episodes: Number.isFinite(raw.episodes) ? raw.episodes : null,
    genres: Array.isArray(raw.genres) ? raw.genres : [],
    synopsis: cleanText(raw.description || raw.synopsis),
  };
}

/** Заголовок для карточки: русский вариант приоритетнее. */
function displayTitle(anime) {
  return anime.titleRu || anime.titleEn || anime.title;
}

/* ------------------------------------------------------------------ */
/*  AniList                                                             */
/* ------------------------------------------------------------------ */

async function searchAniList(query) {
  const data = await graphql(ANILIST_API, ANILIST_SEARCH, { search: query, page: 1 }, { timeout: 12000 });
  const media = data?.Page?.media || [];
  return media
    .map((item) => normalizeAnime(item, 'anilist'))
    .filter(Boolean);
}

/** Популярные аниме — показываются при открытии раздела. */
async function getPopularAnime() {
  const cached = cacheGet('popular');
  if (cached) return cached;

  try {
    const data = await graphql(ANILIST_API, ANILIST_POPULAR, {}, { timeout: 12000 });
    const media = data?.Page?.media || [];
    const results = media.map((item) => normalizeAnime(item, 'anilist')).filter(Boolean);
    return cacheSet('popular', results);
  } catch (err) {
    console.warn('Не удалось загрузить популярные аниме:', err.message);
    return cacheGet('popular') || [];
  }
}

/* ------------------------------------------------------------------ */
/*  Рекомендации для «Моей волны»                                       */
/* ------------------------------------------------------------------ */

/**
 * Похожие аниме по MAL-ID любимых тайтлов.
 * AniList отдаёт граф рекомендаций с рейтингом сходства.
 *
 * @param {number[]} malIds
 * @returns {Promise<{seeds: object[], related: object[]}>}
 */
async function getAnimeRecommendations(malIds) {
  const ids = [...new Set(
    (Array.isArray(malIds) ? malIds : [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0)
  )].slice(0, 5);

  if (!ids.length) return { seeds: [], related: [] };

  const key = `related:${ids.slice().sort((a, b) => a - b).join(',')}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const data = await graphql(
      ANILIST_API,
      ANILIST_RECOMMENDATIONS,
      { ids },
      { timeout: 15000 }
    );

    const seeds = [];
    const byMal = new Map();

    for (const rawSeed of data?.Page?.media || []) {
      const seed = normalizeAnime(rawSeed, 'anilist');
      if (!seed) continue;
      seeds.push(seed);

      for (const edge of rawSeed.recommendations?.nodes || []) {
        const related = normalizeAnime(edge?.mediaRecommendation, 'anilist');
        if (!related?.malId) continue;
        if (ids.includes(related.malId)) continue;

        const rating = Number(edge?.rating);
        const item = {
          ...related,
          rating: Number.isFinite(rating) ? rating : 0,
          seedMalId: seed.malId,
          seedTitle: seed.title,
        };

        const previous = byMal.get(related.malId);
        if (!previous || item.rating > previous.rating) byMal.set(related.malId, item);
      }
    }

    const related = [...byMal.values()]
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 40);

    return cacheSet(key, { seeds, related });
  } catch (err) {
    console.warn('Не удалось загрузить рекомендации AniList:', err.message);
    return cacheGet(key) || { seeds: [], related: [] };
  }
}

/**
 * Поиск аниме по жанрам и страницам AniList. Нужен волне, чтобы получать
 * новые тайтлы не только из маленькой первой страницы популярного.
 *
 * @param {{genres?: string[], page?: number, year?: number, perPage?: number}} options
 * @returns {Promise<object[]>}
 */
async function getAnimeExplore(options = {}) {
  const list = [...new Set(
    (Array.isArray(options.genres) ? options.genres : [])
      .map((genre) => cleanText(genre))
      .filter(Boolean)
  )].slice(0, 3);

  const page = Math.min(100, Math.max(1, Number(options.page) || 1));
  const perPage = Math.min(50, Math.max(10, Number(options.perPage) || 30));
  const year = Number(options.year);
  const exploreYear = Number.isFinite(year) && year > 1900 ? Math.floor(year) : null;

  const key = `explore:${page}:${perPage}:${exploreYear || 'any'}:${list.slice().sort().join(',')}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const data = await graphql(
      ANILIST_API,
      ANILIST_EXPLORE,
      {
        page,
        perPage,
        genres: list.length ? list : null,
        year: exploreYear,
      },
      { timeout: 15000 }
    );
    const media = data?.Page?.media || [];
    return cacheSet(
      key,
      media.map((item) => normalizeAnime(item, 'anilist')).filter(Boolean)
    );
  } catch (err) {
    console.warn('Не удалось загрузить каталог для волны:', err.message);
    return cacheGet(key) || [];
  }
}

/** Популярные аниме в заданных жанрах — источник открытий для волны. */
async function getAnimeByGenres(genres) {
  const list = [...new Set(
    (Array.isArray(genres) ? genres : [])
      .map((genre) => cleanText(genre))
      .filter(Boolean)
  )].slice(0, 3);

  if (!list.length) return [];

  const key = `genres:${list.slice().sort().join(',')}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const data = await graphql(
      ANILIST_API,
      ANILIST_BY_GENRES,
      { genres: list },
      { timeout: 12000 }
    );
    const media = data?.Page?.media || [];
    return cacheSet(
      key,
      media.map((item) => normalizeAnime(item, 'anilist')).filter(Boolean)
    );
  } catch (err) {
    console.warn('Не удалось загрузить аниме по жанрам:', err.message);
    return cacheGet(key) || [];
  }
}

/* ------------------------------------------------------------------ */
/*  Shikimori                                                            */
/* ------------------------------------------------------------------ */

async function shikimoriAvailable() {
  if (shikimoriState.down && Date.now() - shikimoriState.since < SHIKIMORI_RETRY) {
    return false;
  }
  return true;
}

async function searchShikimori(query) {
  if (!(await shikimoriAvailable())) return [];

  const url = `${SHIKIMORI_API}/animes?search=${encodeURIComponent(query)}&limit=20`;
  try {
    const list = await fetchJson(url, { timeout: 5000 });
    shikimoriState.down = false;
    return (Array.isArray(list) ? list : [])
      .map((item) => normalizeAnime(item, 'shikimori'))
      .filter(Boolean);
  } catch (err) {
    // 5xx и сетевые сбои считаем временной недоступностью сайта.
    shikimoriState.down = true;
    shikimoriState.since = Date.now();
    console.warn('Shikimori недоступен:', err.message);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  AnimeThemes                                                          */
/* ------------------------------------------------------------------ */

async function searchAnimeThemes(query) {
  const data = await graphql(THEMES_API, THEMES_SEARCH, { search: query }, { timeout: 12000 });
  const list = data?.animePagination?.data || [];
  const out = [];
  for (const item of list) {
    const malLink = (item.resources?.nodes || []).find((r) => r.site === 'MAL')?.link;
    const malId = malLink ? Number(String(malLink).split('/').filter(Boolean).pop()) : null;
    const anime = normalizeAnime(
      { ...item, idMal: Number.isFinite(malId) ? malId : null },
      'animethemes'
    );
    if (anime) out.push(anime);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Поиск                                                               */
/* ------------------------------------------------------------------ */

/**
 * Объединяет результаты двух источников: русские названия и оценки
 * из Shikimori подставляются к аниме из AniList по совпадению MAL-ID.
 */
function mergeResults(anilist, shikimori) {
  const results = anilist.map((item) => ({ ...item }));

  const byMal = new Map();
  for (const item of shikimori) {
    if (item.malId) byMal.set(item.malId, item);
  }

  for (const item of results) {
    const extra = item.malId ? byMal.get(item.malId) : null;
    if (!extra) continue;
    if (!item.titleRu && extra.titleRu) item.titleRu = extra.titleRu;
    if (!item.synopsis && extra.synopsis) item.synopsis = extra.synopsis;
    if (!item.score && extra.score) item.score = extra.score;
  }

  // Аниме, найденные только в Shikimori, добавляем в конец списка.
  const known = new Set(results.map((r) => r.malId).filter(Boolean));
  for (const item of shikimori) {
    if (item.malId && known.has(item.malId)) continue;
    if (!item.malId && results.some((r) => r.title.toLowerCase() === item.title.toLowerCase())) continue;
    results.push({ ...item });
  }

  return results;
}

/**
 * Поиск аниме.
 *
 * AniList — основной источник: он отвечает быстро и доступен всегда.
 * Shikimori медленный (а сейчас ещё и лежит), поэтому он опрашивается
 * отдельно: если AniList нашёл аниме, ждать Shikimori не нужно —
 * русские названия догружаются в фоне и приходят дополнительным событием.
 *
 * @param {string} query
 * @param {{onEnriched?: Function}} options
 */
async function searchAnime(query, options = {}) {
  const text = cleanText(query);
  if (!text) return { results: [], sources: {} };

  const key = `search:${text.toLowerCase()}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const anilist = await searchAniList(text).catch((err) => {
    console.warn('AniList недоступен:', err.message);
    return [];
  });

  let results = anilist;
  let sources = { anilist: anilist.length ? 'ok' : 'empty', shikimori: 'pending' };

  if (anilist.length) {
    // Быстрый путь: отдаём результат сразу и уточняем его в фоне.
    const pending = cacheSet(key, { results, sources });

    searchShikimori(text)
      .then((shikimori) => {
        if (!shikimori.length) {
          // Источник не дал результата — фиксируем его состояние.
          const current = cacheGet(key);
          const sources = { anilist: 'ok', shikimori: shikimoriState.down ? 'unavailable' : 'empty' };
          if (current) {
            current.sources = sources;
          }
          if (typeof options.onEnriched === 'function') {
            options.onEnriched({ results: anilist, sources });
          }
          return;
        }
        const merged = mergeResults(anilist, shikimori);
        const enriched = { results: merged, sources: { anilist: 'ok', shikimori: 'ok' } };
        cacheSet(key, enriched);
        if (typeof options.onEnriched === 'function') options.onEnriched(enriched);
      })
      .catch(() => {});

    return pending;
  }

  // AniList ничего не нашёл — пробуем Shikimori, затем базу опенингов.
  const shikimori = await searchShikimori(text).catch(() => []);
  results = shikimori;

  if (!results.length) {
    results = await searchAnimeThemes(text).catch(() => []);
  }

  sources = {
    anilist: anilist.length ? 'ok' : 'empty',
    shikimori: shikimori.length ? 'ok' : (shikimoriState.down ? 'unavailable' : 'empty'),
  };

  return cacheSet(key, { results, sources });
}

/* ------------------------------------------------------------------ */
/*  Опенинги и эндинги                                                  */
/* ------------------------------------------------------------------ */

function themeTypeLabel(type) {
  if (type === 'OP') return 'OP';
  if (type === 'ED') return 'ED';
  if (type === 'IN') return 'IN';
  return type || '';
}

/**
 * Приводит тему из AnimeThemes к виду трека нашего плеера.
 */
function buildTrack(anime, theme, entry, video) {
  const audio = video?.audio?.link || null;
  if (!audio) return null;

  const songTitle = cleanText(theme.song?.title?.romaji || theme.song?.title?.native) || 'Без названия';
  const artists = (theme.song?.performances || [])
    .map((p) => {
      const name = cleanText(p.artist?.name?.main);
      if (!name) return '';
      return p.as ? `${name} как ${p.as}` : name;
    })
    .filter(Boolean);

  const type = themeTypeLabel(theme.type);
  const seq = theme.sequence ?? 0;
  const version = entry.version ?? 1;
  const cover = anime.cover;

  // У одной темы бывает несколько версий видео (разные источники записи),
  // поэтому в идентификатор входит имя файла — иначе треки сливаются.
  const variant = audio.split('/').pop().replace(/\.[^.]+$/, '');

  return {
    id: `anime:${anime.malId ?? anime.id}:${type}${seq}:v${version}:${variant}`,
    source: 'anime',
    animeId: anime.id,
    animeTitle: anime.title,
    animeTitleRu: anime.titleRu,
    title: songTitle,
    artist: artists.join(', ') || 'Неизвестный исполнитель',
    album: anime.titleRu || anime.title,
    albumArtist: artists.join(', ') || null,
    trackNumber: seq,
    themeType: type,
    version,
    episodes: entry.episodes || null,
    nsfw: Boolean(entry.nsfw),
    spoiler: Boolean(entry.spoiler),
    lyrics: Boolean(video.lyrics),
    resolution: video.resolution || null,
    duration: null,
    hasCover: Boolean(cover),
    coverUrl: cover,
    audioUrl: audio,
    videoUrl: video.link || null,
    path: null,
  };
}

/**
 * Возвращает список опенингов/эндингов для аниме.
 * @param {{malId?: number, title?: string}} target
 */
async function getAnimeThemes(target, options = {}) {
  const malId = Number(target?.malId);
  const title = cleanText(target?.title);

  const key = `themes:${malId || title}`;
  const cached = cacheGet(key);
  const onDuration = typeof options.onDurations === 'function' ? options.onDurations : null;
  const reportDuration = onDuration
    ? (track, duration) => onDuration(new Map([[track.id, duration]]))
    : null;

  if (cached) {
    // Волна запрашивает темы без массового определения длительности.
    // Если позже список открыли в обычном разделе — догружаем время здесь.
    if (options.probeDurations !== false) fillDurations(cached.tracks, reportDuration);
    return cached;
  }

  let raw = null;

  if (Number.isFinite(malId) && malId > 0) {
    const link = `https://myanimelist.net/anime/${malId}`;
    const data = await graphql(THEMES_API, THEMES_QUERY, { link }, { timeout: 15000 });
    raw = data?.findAnimeByExternalSite?.[0] || null;
  }

  // Запасной путь — ищем по названию, если по MAL-ID ничего не нашлось.
  if (!raw && title) {
    const found = await searchAnimeThemes(title).catch(() => []);
    if (found.length) {
      const data = await graphql(
        THEMES_API,
        THEMES_QUERY,
        { link: `https://myanimelist.net/anime/${found[0].malId || 1}` },
        { timeout: 15000 }
      );
      raw = data?.findAnimeByExternalSite?.[0] || null;
    }
  }

  if (!raw) {
    return cacheSet(key, { anime: null, tracks: [], found: false });
  }

  const anime = normalizeAnime(raw, 'animethemes');
  if (anime && Number.isFinite(malId) && malId > 0) anime.malId = malId;

  const tracks = [];
  // AnimeThemes нередко отдаёт одну и ту же запись несколько раз: например,
  // у опенинга есть версии v1 и v2, но аудиофайл у них общий. Поэтому
  // дедуплицируем по адресу аудио, а не по связке «тема + версия + видео».
  const seenAudio = new Set();
  for (const theme of raw.animethemes || []) {
    for (const entry of theme.animethemeentries || []) {
      for (const video of entry.videos?.nodes || []) {
        const audio = video?.audio?.link || null;
        if (!audio || seenAudio.has(audio)) continue;
        seenAudio.add(audio);
        const track = buildTrack(anime, theme, entry, video);
        if (track) tracks.push(track);
      }
    }
  }

  // Порядок: сначала опенинги, потом эндинги; внутри — по номеру и версии.
  const order = { OP: 0, ED: 1, IN: 2 };
  tracks.sort((a, b) => {
    const byType = (order[a.themeType] ?? 3) - (order[b.themeType] ?? 3);
    if (byType) return byType;
    if (a.trackNumber !== b.trackNumber) return a.trackNumber - b.trackNumber;
    return a.version - b.version;
  });

  // Длительность лежит в самом файле. Узнаём её в фоне, чтобы
  // список опенингов появился сразу, а время подставлялось по мере готовности.
  const result = cacheSet(key, { anime, tracks, found: true });
  if (options.probeDurations !== false) fillDurations(tracks, reportDuration);

  return result;
}

/**
 * Узнаёт длительность треков, у которых она ещё неизвестна.
 * Каждую найденную длительность сразу отдаёт в onDuration — так интерфейс
 * обновляется постепенно, а не ждёт, пока обработается весь список.
 *
 * @param {Array} tracks
 * @param {((track: object, duration: number) => void) | null} onDuration
 */
async function fillDurations(tracks, onDuration) {
  const unknown = tracks.filter((t) => !t.duration && t.audioUrl);
  if (!unknown.length) return;

  // Больше параллельных запросов — быстрее заполняется список.
  const CONCURRENCY = 10;
  let cursor = 0;

  const workers = Array.from({ length: Math.min(CONCURRENCY, unknown.length) }, async () => {
    while (cursor < unknown.length) {
      const track = unknown[cursor++];
      try {
        const duration = await getOggDuration(track.audioUrl);
        if (duration) {
          track.duration = duration;
          if (onDuration) onDuration(track, duration);
        }
      } catch {
        /* длительность останется неизвестной — это не критично */
      }
    }
  });

  await Promise.all(workers);
}

module.exports = {
  searchAnime,
  getAnimeThemes,
  getPopularAnime,
  getAnimeRecommendations,
  getAnimeByGenres,
  getAnimeExplore,
  displayTitle,
};
