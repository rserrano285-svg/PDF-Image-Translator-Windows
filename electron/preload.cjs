const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveTranslatedFile: (payload) => ipcRenderer.invoke('save-translated-file', payload),
});
