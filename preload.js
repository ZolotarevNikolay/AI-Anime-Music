'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Безопасный мост между интерфейсом и главным процессом.
 * Всё, что доступно окну, перечислено явно — никакого прямого доступа к Node API.
 */
contextBridge.exposeInMainWorld('player', {
  getState: () => ipcRenderer.invoke('library:state'),
  saveState: (patch) => ipcRenderer.invoke('library:saveState', patch),
  openExternal: (url) => ipcRenderer.invoke('media:openExternal', url),

  // Аниме: поиск, популярные, опенинги и эндинги.
  searchAnime: (query) => ipcRenderer.invoke('anime:search', query),
  popularAnime: () => ipcRenderer.invoke('anime:popular'),
  animeThemes: (target) => ipcRenderer.invoke('anime:themes', target),
  relatedAnime: (malIds) => ipcRenderer.invoke('anime:related', malIds),
  animeByGenres: (genres) => ipcRenderer.invoke('anime:genres', genres),
  exploreAnime: (options) => ipcRenderer.invoke('anime:explore', options),

  // Событие: поиск уточнён медленным источником (русские названия).
  onAnimeEnriched: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('anime:enriched', listener);
    return () => ipcRenderer.removeListener('anime:enriched', listener);
  },

  // Событие: уточнена длительность опенингов.
  onAnimeDurations: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('anime:durations', listener);
    return () => ipcRenderer.removeListener('anime:durations', listener);
  },
});
