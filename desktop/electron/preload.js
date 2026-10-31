const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('lmhr', {
  connect: (url, force) => ipcRenderer.invoke('lmhr:connect', url, !!force),
  retry: () => ipcRenderer.send('lmhr:retry'),
  openConfig: () => ipcRenderer.send('lmhr:open-config'),
})
