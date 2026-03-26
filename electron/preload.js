const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickSaveFolder: () => ipcRenderer.invoke('pick-save-folder'),
  startDownload: (url, outputDir) =>
    ipcRenderer.invoke('start-download', { url, outputDir }),
  cancelDownload: () => ipcRenderer.invoke('cancel-download'),
  openFolder: (filePath) => ipcRenderer.invoke('open-folder', filePath),
  onProgress: (fn) => {
    const listener = (_e, payload) => fn(payload);
    ipcRenderer.on('download-progress', listener);
    return () =>
      ipcRenderer.removeListener('download-progress', listener);
  },
});
