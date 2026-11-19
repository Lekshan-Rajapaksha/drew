import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Bridge, BrowserState, Shortcut } from '../../shared/model.js'

const bridge: Bridge = {
  platform: process.platform,
  version: '0.3.1',
  getState: () => ipcRenderer.invoke('lexn:state'),
  command: (name, ...args) => ipcRenderer.invoke('lexn:command', name, args),
  history: query => ipcRenderer.invoke('lexn:history', query),
  frequent: () => ipcRenderer.invoke('lexn:frequent'),
  cookies: () => ipcRenderer.invoke('lexn:cookies'),
  layout: rect => ipcRenderer.send('lexn:layout', rect),
  onState: listener => {
    const handle = (_event: IpcRendererEvent, state: BrowserState) => listener(state)
    ipcRenderer.on('lexn:state', handle)
    return () => ipcRenderer.removeListener('lexn:state', handle)
  },
  onShortcut: listener => {
    const handle = (_event: IpcRendererEvent, name: Shortcut) => listener(name)
    ipcRenderer.on('lexn:shortcut', handle)
    return () => ipcRenderer.removeListener('lexn:shortcut', handle)
  },
}

contextBridge.exposeInMainWorld('lexn', bridge)
