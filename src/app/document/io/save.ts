import type { EditorState } from '@open-pencil/core/editor'
import { filesMessages } from '@open-pencil/vue'

import { downloadBlob } from '@/app/document/io/browser'
import { documentNameFromFigPath } from '@/app/document/io/names'
import { chooseBrowserFigSaveHandle, chooseTauriFigSavePath } from '@/app/document/io/save-targets'
import type { DocumentSourceAccess } from '@/app/document/io/types'
import { createDocumentWriter } from '@/app/document/io/write'
import { IS_TAURI } from '@/constants'

type SaveDocumentState = EditorState & { documentName: string }

type SaveActionsOptions = Omit<DocumentSourceAccess, 'getSavedVersion'> & {
  state: SaveDocumentState
  /** The document's content revision, recorded as the saved version. */
  version: () => number
  buildFigFile: (version: number) => Uint8Array | Promise<Uint8Array>
  buildAdmittedFigFile: (version: number) => Uint8Array | Promise<Uint8Array>
  startWatchingFile: () => void
  onWriteSuccess?: (version: number) => void | Promise<void>
  onDownloadSuccess?: (version: number) => void | Promise<void>
}

export function createSaveActions({
  state,
  version: currentVersion,
  buildFigFile,
  buildAdmittedFigFile,
  getFilePath,
  setFilePath,
  getFileHandle,
  setFileHandle,
  getDownloadName,
  setDownloadName,
  getStorageBinding,
  setStorageBinding,
  setSourceIdentity,
  setSavedVersion,
  setLastWriteTime,
  beginWrite,
  startWatchingFile,
  onWriteSuccess,
  onDownloadSuccess
}: SaveActionsOptions) {
  const writeFile = createDocumentWriter({
    state,
    getFilePath,
    getFileHandle,
    getStorageBinding,
    setSavedVersion,
    setLastWriteTime,
    beginWrite,
    onWriteSuccess
  })

  async function buildVersionedFigFile(admittedVersion?: number) {
    const version = admittedVersion ?? currentVersion()
    const build = admittedVersion === undefined ? buildFigFile : buildAdmittedFigFile
    return { data: await build(version), version }
  }

  async function saveFigFile(admittedVersion?: number) {
    const filePath = getFilePath()
    const fileHandle = getFileHandle()
    const storageBinding = getStorageBinding()
    const downloadName = getDownloadName()
    if (storageBinding || filePath || fileHandle) {
      const { data, version } = await buildVersionedFigFile(admittedVersion)
      const wrote = await writeFile(data, version)
      if (wrote && !storageBinding) setSourceIdentity({ handle: fileHandle, path: filePath })
      return wrote
    }
    if (downloadName) {
      const { data, version } = await buildVersionedFigFile(admittedVersion)
      downloadBlob(new Uint8Array(data), downloadName, 'application/octet-stream')
      await onDownloadSuccess?.(version)
      return true
    }
    if (admittedVersion !== undefined)
      throw new Error('Admitted Save has no writable target; no file write was started')
    return saveFigFileAs()
  }

  async function saveFigFileAs() {
    const { data, version } = await buildVersionedFigFile()

    if (IS_TAURI) {
      const path = await chooseTauriFigSavePath()
      if (!path) return false
      setStorageBinding(null)
      setFilePath(path)
      setFileHandle(null)
      state.documentName = documentNameFromFigPath(path)
      const wrote = await writeFile(data, version)
      if (wrote) setSourceIdentity({ handle: null, path })
      startWatchingFile()
      return wrote
    }

    // The picker helper returns null when the browser has no File System Access API.
    const handle = await chooseBrowserFigSaveHandle()
    if (handle) {
      setStorageBinding(null)
      setFileHandle(handle)
      setFilePath(null)
      state.documentName = documentNameFromFigPath(handle.name)
      const wrote = await writeFile(data, version)
      if (wrote) setSourceIdentity({ handle, path: null })
      startWatchingFile()
      return wrote
    }

    const filename = prompt(filesMessages.get().saveAsPrompt, getDownloadName() ?? 'Untitled.fig')
    if (!filename) return false
    setStorageBinding(null)
    setDownloadName(filename)
    state.documentName = documentNameFromFigPath(filename)
    downloadBlob(new Uint8Array(data), filename, 'application/octet-stream')
    await onDownloadSuccess?.(version)
    return true
  }

  return {
    saveFigFile: () => saveFigFile(),
    saveFigFileAdmitted: (version: number) => saveFigFile(version),
    saveFigFileAs,
    writeFile
  }
}
