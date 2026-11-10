// Narrow bridge between the Angular UI and the main process.
const { contextBridge, ipcRenderer } = require('electron');

function listen(channel, cb) {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('questApi', {
  getState: () => ipcRenderer.invoke('state:get'),
  dispatch: (action) => ipcRenderer.invoke('state:dispatch', action),
  onState: (cb) => listen('state:changed', cb),

  // Popup / window behaviour
  onPinned: (cb) => listen('popup:pinned', cb),
  setPinned: (pinned) => ipcRenderer.send('popup:pin', pinned),
  setEditing: (editing) => ipcRenderer.send('popup:editing', editing),
  hideWindow: () => ipcRenderer.send('window:hide'),
  openEditor: () => ipcRenderer.send('editor:open'),
  openDataFolder: () => ipcRenderer.send('data:openFolder'),
});
