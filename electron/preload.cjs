const { contextBridge, ipcRenderer } = require('electron');
const listen = (channel, callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('chii', {
  getUpdateState: () => ipcRenderer.invoke('chii:update-state'),
  onUpdateState: callback => listen('chii:update-state', callback),
  checkForUpdates: () => ipcRenderer.invoke('chii:update-check'),
  downloadUpdate: () => ipcRenderer.invoke('chii:update-download'),
  installUpdate: () => ipcRenderer.invoke('chii:update-install'),
  getState: () => ipcRenderer.invoke('chii:state'),
  onState: callback => listen('chii:state', callback),
  updateConfig: patch => ipcRenderer.invoke('chii:config', patch),
  setCredentials: value => ipcRenderer.invoke('chii:credentials', value),
  clearCredentials: () => ipcRenderer.invoke('chii:clear-credentials'),
  connect: () => ipcRenderer.invoke('chii:connect'),
  demo: () => ipcRenderer.invoke('chii:demo'),
  searchStocks: query => ipcRenderer.invoke('chii:search', query),
  refreshPortfolio: () => ipcRenderer.invoke('chii:portfolio-refresh'),
  selectAccount: id => ipcRenderer.invoke('chii:portfolio-select', id),
  previewMotion: action => ipcRenderer.send('chii:motion', action),
  onMotion: callback => listen('chii:motion', callback),
  onBulletin: callback => listen('chii:bulletin', callback),
  setInteractive: value => ipcRenderer.send('chii:interactive', value),
  beginPetDrag: input => ipcRenderer.send('chii:pet-drag-begin', input),
  endPetDrag: input => ipcRenderer.send('chii:pet-drag-end', input),
  onPetPlacement: callback => listen('chii:pet-placement', callback),
  onPetDragEnded: callback => listen('chii:pet-drag-ended', callback),
  showSettings: () => ipcRenderer.send('chii:settings'),
  openDocs: () => ipcRenderer.send('chii:docs'),
  hidePet: () => ipcRenderer.send('chii:hide-pet'),
  quit: () => ipcRenderer.send('chii:quit')
});
