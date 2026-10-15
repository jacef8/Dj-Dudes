// Bridge between the page and the desktop: lets the app find where a dropped
// song lives on disk, read songs back later, and manage playlist files.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('native', {
  pathForFile: file => {
    try { return webUtils.getPathForFile(file) || ''; } catch { return ''; }
  },
  readFile: path => ipcRenderer.invoke('read-file', path),
  playlistDir: () => ipcRenderer.invoke('playlist-dir'),
  listPlaylists: () => ipcRenderer.invoke('list-playlists'),
  readPlaylist: name => ipcRenderer.invoke('read-playlist', name),
  savePlaylist: (name, items) => ipcRenderer.invoke('save-playlist', name, items),
  deletePlaylist: name => ipcRenderer.invoke('delete-playlist', name),
  openPlaylistFolder: () => ipcRenderer.invoke('open-playlist-folder'),
});
