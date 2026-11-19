import { create } from 'zustand'
import type { Bridge, BrowserState, Commands } from '../shared/model'

declare global { interface Window { lexn: Bridge } }

export type Page = 'passwords' | 'extensions' | 'archive' | 'bookmarks' | 'history' | 'downloads' | 'settings'
interface AppState {
  browser: BrowserState | null
  page: Page | null
  error: string
  setBrowser: (browser: BrowserState) => void
  setPage: (page: Page | null) => void
  setError: (error: string) => void
}
export const useApp = create<AppState>(set => ({
  browser: null, page: null, error: '',
  setBrowser: browser => set({ browser }),
  setPage: page => set({ page, error: '' }),
  setError: error => set({ error }),
}))

export async function command<K extends keyof Commands>(name: K, ...args: Commands[K]): Promise<boolean> {
  try {
    await window.lexn.command(name, ...args)
    return true
  } catch (error) {
    useApp.getState().setError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error))
    return false
  }
}

export const siteName = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}
