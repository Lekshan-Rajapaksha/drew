import { ipcRenderer } from 'electron'

window.addEventListener('DOMContentLoaded', () => {
  const origin = document.getElementById('origin')
  const connection = document.getElementById('connection')
  document.getElementById('open')?.addEventListener('click', event => {
    if (event.isTrusted) ipcRenderer.send('drew:peek-promote')
  })
  ipcRenderer.on('drew:peek-status', (_event, site: string, address: string, status: string) => {
    if (origin && connection) {
      origin.textContent = site
      origin.title = address
      connection.textContent = status
    }
  })
}, { once: true })
