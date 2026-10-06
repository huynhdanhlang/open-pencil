import { watchBrowserFile, watchTauriFile } from '@/app/document/io/watch-targets'
import { IS_TAURI } from '@/constants'

type FileWatchOptions = {
  getFilePath: () => string | null
  getFileHandle: () => FileSystemFileHandle | null
  getLastWriteTime: () => number
  reloadFromDisk: () => void
}

export function createFileWatcher(
  { getFilePath, getFileHandle, getLastWriteTime, reloadFromDisk }: FileWatchOptions,
  targets = { isTauri: IS_TAURI, watchTauriFile, watchBrowserFile }
) {
  let unwatchFile: (() => void) | null = null
  let generation = 0
  let disposed = false

  function stopWatchingFile() {
    generation++
    if (unwatchFile) {
      unwatchFile()
      unwatchFile = null
    }
  }

  async function startWatchingFile() {
    if (disposed) return
    stopWatchingFile()
    const started = generation
    const current = () => !disposed && started === generation
    const reload = () => {
      if (current()) reloadFromDisk()
    }
    const stop = () => {
      if (current()) stopWatchingFile()
    }
    const filePath = getFilePath()
    const fileHandle = getFileHandle()
    let unwatch: (() => void) | null = null

    if (filePath && targets.isTauri) {
      unwatch = await targets.watchTauriFile(filePath, getLastWriteTime, reload)
    } else if (fileHandle) {
      unwatch = await targets.watchBrowserFile(
        fileHandle,
        getFileHandle,
        getLastWriteTime,
        reload,
        stop
      )
    }
    if (!current()) {
      unwatch?.()
      return
    }
    unwatchFile = unwatch
  }

  function dispose() {
    disposed = true
    stopWatchingFile()
  }

  return { startWatchingFile, stopWatchingFile, dispose }
}
