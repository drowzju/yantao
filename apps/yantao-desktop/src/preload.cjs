'use strict'

/**
 * The renderer's only seam to the desktop shell (ADR-0016): a fire-and-forget
 * notify. The shell turns it into a system notification — but only while the
 * window is hidden, so a visible workbench never double-reports what it can
 * show in place. Node stays out of the renderer; this bridge is one channel.
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('yantao', {
  notify: (message) => { ipcRenderer.send('yantao:notify', message) },
})
