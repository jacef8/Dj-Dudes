// Bridge between the page and the desktop: lets the app find where a dropped
// song lives on disk, read songs back later, and manage playlist files.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('native', {
  pathForFile: file => {
    try { return webUtils.getPathForFile(file) || ''; } catch { return ''; }
  },
  readFile: path => ipcRenderer.invoke('read-file', path),
  youtubePlaylistFeed: listId => ipcRenderer.invoke('yt-playlist-feed', listId),
  playlistDir: () => ipcRenderer.invoke('playlist-dir'),
  listPlaylists: () => ipcRenderer.invoke('list-playlists'),
  readPlaylist: name => ipcRenderer.invoke('read-playlist', name),
  savePlaylist: (name, items) => ipcRenderer.invoke('save-playlist', name, items),
  deletePlaylist: name => ipcRenderer.invoke('delete-playlist', name),
  removeYouTubeFromPlaylist: (name, ids) => ipcRenderer.invoke('playlist-remove-youtube', name, ids),
  openPlaylistFolder: () => ipcRenderer.invoke('open-playlist-folder'),

  remote: {
    info: () => ipcRenderer.invoke('remote-info'),
    setEnabled: on => ipcRenderer.invoke('remote-set-enabled', on),
    reset: () => ipcRenderer.invoke('remote-reset'),
    sendState: state => ipcRenderer.send('remote-state', state),
    onCommand: cb => ipcRenderer.on('remote-cmd', (_e, cmd) => cb(cmd)),
  },

  guests: {
    info: () => ipcRenderer.invoke('guest-info'),
    setEnabled: on => ipcRenderer.invoke('guest-set-enabled', on),
    reset: () => ipcRenderer.invoke('guest-reset'),
    sendState: state => ipcRenderer.send('guest-state', state),
    setLibrary: list => ipcRenderer.send('guest-library', list),
    /** cb({ key, name }) returns { ok, message } (or a promise of it). */
    onRequest: cb => ipcRenderer.on('guest-request', async (_e, req) => {
      let result;
      try { result = await cb(req); } catch { result = { ok: false, message: 'Something went wrong.' }; }
      ipcRenderer.send('guest-request-result', { id: req.id, ...result });
    }),
  },
});
