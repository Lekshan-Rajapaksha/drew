import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Bridge, BrowserState, SpaceScroll, Shortcut } from '../../shared/model.js'

const bridge: Bridge = {
  platform: process.platform,
  version: '0.5.6',
  getState: () => ipcRenderer.invoke('lexn:state'),
  command: (name, ...args) => ipcRenderer.invoke('lexn:command', name, args),
  history: query => ipcRenderer.invoke('lexn:history', query),
  frequent: () => ipcRenderer.invoke('lexn:frequent'),
  cookies: () => ipcRenderer.invoke('lexn:cookies'),
  layout: rect => ipcRenderer.send('lexn:layout', rect),
  layoutSidebar: (width, open, animate) => ipcRenderer.send('lexn:sidebar-layout', width, open, animate),
  onState: listener => {
    const handle = (_event: IpcRendererEvent, state: BrowserState) => listener(state)
    ipcRenderer.on('lexn:state', handle)
    return () => ipcRenderer.removeListener('lexn:state', handle)
  },
  usesNativeSpaceScroll: () => ipcRenderer.invoke('lexn:uses-native-space-scroll'),
  onSpaceScroll: listener => {
    const handle = (_event: IpcRendererEvent, scroll: SpaceScroll) => listener(scroll)
    ipcRenderer.on('lexn:space-scroll', handle)
    return () => ipcRenderer.removeListener('lexn:space-scroll', handle)
  },
  onPointer: listener => {
    const handle = (_event: IpcRendererEvent, x: number | null) => listener(x)
    ipcRenderer.on('lexn:pointer', handle)
    return () => ipcRenderer.removeListener('lexn:pointer', handle)
  },
  onShortcut: listener => {
    const handle = (_event: IpcRendererEvent, name: Shortcut) => listener(name)
    ipcRenderer.on('lexn:shortcut', handle)
    return () => ipcRenderer.removeListener('lexn:shortcut', handle)
  },
}

contextBridge.exposeInMainWorld('lexn', bridge)
