import type { Editor, EditorState } from '@open-pencil/core/editor'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'

import { createAutosave } from '@/app/document/autosave'
import { createDocumentChanges } from '@/app/document/io/changes'
import { createFigBuildQueue } from '@/app/document/io/fig-build-queue'
import {
  documentNameFromFigPath,
  downloadNameFromPath,
  figDownloadName
} from '@/app/document/io/names'
import { createSaveActions } from '@/app/document/io/save'
import { createDocumentSourceState } from '@/app/document/io/source-state'
import type { DocumentSaveAdmission, DocumentSourceAccess } from '@/app/document/io/types'
import { createDocumentRecovery } from '@/app/document/recovery'
import { recoveryEnabled } from '@/app/document/recovery/preferences'
import {
  getRecoveryMemoryUsage,
  isRecoveryStoreMemoryFallback
} from '@/app/document/recovery/store'
import { notificationMessages } from '@/app/i18n/notifications'
import type { StorageDocumentBinding, StorageProviderID } from '@/app/integrations/storage/types'
import { toast } from '@/app/shell/ui'
import { createCanvasId } from '@/app/storage/id'

type DocumentSourceState = EditorState & {
  documentName: string
  autosaveEnabled: boolean
}

export { createDocumentSourceState }

type DocumentSourceOptions = DocumentSourceAccess & {
  editor: Editor
  state: DocumentSourceState
  stopWatchingFile: () => void
  startWatchingFile: () => Promise<void>
  getRenderer: () => Editor['renderer']
}

export function createDocumentSourceActions({
  editor,
  state,
  stopWatchingFile,
  startWatchingFile,
  getFileHandle,
  setFileHandle,
  getFilePath,
  setFilePath,
  getDownloadName,
  setDownloadName,
  getStorageBinding,
  setStorageBinding,
  setSourceIdentity,
  getSavedVersion,
  setSavedVersion,
  setLastWriteTime,
  beginWrite,
  getRenderer
}: DocumentSourceOptions) {
  const changes = createDocumentChanges(editor)
  let renderingFailed = false
  let rendererIndependentVersion: number | null = null
  const figBuildQueue = createFigBuildQueue(() => editor.graph)

  async function protectSavedRevision(revision: number) {
    try {
      await recovery.markProtectedVersion(revision)
    } catch (error) {
      // The canonical write has already succeeded; recovery failure is separate.
      console.warn('[Recovery] Cleanup after document write failed:', error)
    }
  }

  async function saveAndTrack(save: () => Promise<boolean>, revision = changes.capture()) {
    const saved = await save()
    if (saved) {
      changes.markSaved(revision)
      await protectSavedRevision(revision)
    }
    return saved
  }

  async function buildFigFile(version: number) {
    if (renderingFailed) return buildRendererIndependentFigFile(version)
    const renderer = getRenderer()
    try {
      return await exportFigFile(
        editor.graph,
        renderer?.ck,
        renderer ?? undefined,
        state.currentPageId
      )
    } catch (error) {
      if (
        !(error instanceof WebAssembly.RuntimeError) ||
        !/Aborted\(|out of memory|memory access out of bounds/i.test(error.message)
      )
        throw error
      renderingFailed = true
      console.warn(
        '[Save] CanvasKit failed; preserving editable FIG data without a new preview',
        error
      )
      return buildRendererIndependentFigFile(version)
    }
  }

  function buildRendererIndependentFigFile(version: number) {
    rendererIndependentVersion = version
    return buildRecoveryFigFile()
  }

  function buildRecoveryFigFile() {
    return exportFigFile(editor.graph, undefined, undefined, state.currentPageId, false, {
      rendering: 'none'
    })
  }

  const recovery = createDocumentRecovery({
    state,
    version: changes.capture,
    isEnabled: () => recoveryEnabled.value,
    buildFigFile: () => figBuildQueue.run(buildRecoveryFigFile)
  })

  async function markProtectedVersion(version: number) {
    if (rendererIndependentVersion === version) {
      rendererIndependentVersion = null
      toast.warning(notificationMessages.get().savedWithoutPreview)
    }
  }

  const { saveFigFile, saveFigFileAdmitted, saveFigFileAs, writeFile } = createSaveActions({
    state,
    version: changes.capture,
    buildFigFile: (version) => figBuildQueue.run(() => buildFigFile(version)),
    buildAdmittedFigFile: buildFigFile,
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
    startWatchingFile: () => {
      void startWatchingFile()
    },
    onWriteSuccess: markProtectedVersion,
    onDownloadSuccess: markProtectedVersion
  })

  const autosave = createAutosave({
    state,
    version: changes.capture,
    getSavedVersion,
    hasUnsavedChanges: changes.hasUnsavedChanges,
    hasWritableSource: () => !!getFileHandle() || !!getFilePath() || !!getStorageBinding(),
    saveCurrentDocument: async (version) => {
      const revision = changes.capture()
      const data = await figBuildQueue.run(() => buildFigFile(version))
      if (await writeFile(data, version)) {
        changes.markSaved(revision)
        await protectSavedRevision(revision)
      }
    }
  })

  function markDocumentSaved() {
    const revision = changes.capture()
    changes.markSaved(revision)
    setSavedVersion(revision)
    void protectSavedRevision(revision)
  }

  function setDocumentSource(
    fileName: string,
    sourceFormat: string,
    handle?: FileSystemFileHandle,
    path?: string
  ) {
    stopWatchingFile()
    setStorageBinding(null)
    const isFig = sourceFormat === 'fig'
    setFileHandle(isFig ? (handle ?? null) : null)
    setFilePath(isFig ? (path ?? null) : null)
    setDownloadName(figDownloadName(fileName, sourceFormat))
    setSourceIdentity({ handle: handle ?? null, path: path ?? null })
    markDocumentSaved()
    if (isFig && (handle || path)) {
      void startWatchingFile()
    }
  }

  function setStorageDocumentSource(binding: StorageDocumentBinding, documentName: string) {
    stopWatchingFile()
    setFileHandle(null)
    setFilePath(null)
    setDownloadName(`${documentName}.fig`)
    setSourceIdentity({ handle: null, path: null })
    setStorageBinding(binding)
    state.documentName = documentName
    state.autosaveEnabled = true
    markDocumentSaved()
  }

  function setPlannedFilePath(path: string) {
    stopWatchingFile()
    setStorageBinding(null)
    setFileHandle(null)
    setFilePath(path)
    const downloadName = downloadNameFromPath(path)
    setDownloadName(downloadName)
    state.documentName = documentNameFromFigPath(downloadName)
  }

  let retargeting = false

  function admitSave(
    run: (revision: number) => Promise<boolean>,
    admission: DocumentSaveAdmission
  ) {
    const revision = changes.capture()
    return figBuildQueue.run(() => {
      // A blocked event loop can delay the transport's abort timer.
      if (admission.deadlineAt !== undefined && Date.now() >= admission.deadlineAt)
        throw new Error('Request expired before Save started; no file write was started')
      return run(revision)
    }, admission.signal)
  }

  /**
   * Save to a new target; when the write fails, the document keeps the source it had. A second
   * retarget while one is in flight is refused, so a failure never restores another save's target.
   */
  async function saveToNewTarget(
    planTarget: () => void,
    save = saveFigFile,
    revision?: number
  ): Promise<boolean> {
    if (retargeting) return false
    retargeting = true
    const previous = {
      filePath: getFilePath(),
      fileHandle: getFileHandle(),
      storageBinding: getStorageBinding(),
      downloadName: getDownloadName(),
      documentName: state.documentName
    }
    const restore = () => {
      setStorageBinding(previous.storageBinding)
      setFileHandle(previous.fileHandle)
      setFilePath(previous.filePath)
      setDownloadName(previous.downloadName)
      state.documentName = previous.documentName
      if (previous.filePath || previous.fileHandle) void startWatchingFile()
    }
    planTarget()
    try {
      const saved = await saveAndTrack(save, revision)
      if (!saved) restore()
      return saved
    } catch (error) {
      restore()
      throw error
    } finally {
      retargeting = false
    }
  }

  async function saveFigFileToPath(
    path: string,
    admission?: DocumentSaveAdmission
  ): Promise<boolean> {
    const plan = () => setPlannedFilePath(path)
    const saved = admission
      ? await admitSave(
          (revision) => saveToNewTarget(plan, () => saveFigFileAdmitted(revision), revision),
          admission
        )
      : await saveToNewTarget(plan)
    if (saved) void startWatchingFile()
    return saved
  }

  /** Upload the document to storage as a new stored document and keep editing it there. */
  async function saveFigFileToStorage(providerId: StorageProviderID): Promise<boolean> {
    const saved = await saveToNewTarget(() => {
      stopWatchingFile()
      setFileHandle(null)
      setFilePath(null)
      setDownloadName(`${state.documentName}.fig`)
      setStorageBinding({ providerId, documentId: createCanvasId() })
    })
    if (saved) {
      setSourceIdentity({ handle: null, path: null })
      state.autosaveEnabled = true
    }
    return saved
  }

  function startWatchingCurrentFile() {
    void startWatchingFile()
  }

  function disposeDocumentIO() {
    figBuildQueue.dispose()
    changes.dispose()
    stopWatchingFile()
    autosave.disposeAutosave()
    recovery.disposeRecovery()
  }

  return {
    setDocumentSource,
    setStorageDocumentSource,
    setPlannedFilePath,
    saveFigFileToPath,
    saveFigFileToStorage,
    startWatchingCurrentFile,
    disposeDocumentIO,
    runDocumentOperation: <T>(run: () => Promise<T>, signal?: AbortSignal) =>
      figBuildQueue.run(run, signal),
    saveFigFile: (admission?: DocumentSaveAdmission) =>
      admission
        ? admitSave(
            (revision) => saveAndTrack(() => saveFigFileAdmitted(revision), revision),
            admission
          )
        : saveAndTrack(saveFigFile),
    saveFigFileAs: () => saveAndTrack(saveFigFileAs),
    hasUnsavedChanges: changes.hasUnsavedChanges,
    getPersistenceStatus: () => {
      const memory = getRecoveryMemoryUsage()
      return {
        contentRevision: changes.capture(),
        dirty: changes.hasUnsavedChanges(),
        memoryFallback: isRecoveryStoreMemoryFallback(),
        recoveryMemory: memory ? { scope: 'shared-recovery-store' as const, ...memory } : null,
        recovery: recovery.getDiagnostics()
      }
    },
    markDocumentSaved,
    getStorageBinding,
    getRecoveryId: () => recovery.getRecoveryId(),
    adoptRecoverySnapshot: (id: string) => {
      changes.markChanged()
      return recovery.adoptRecoverySnapshot(id)
    },
    persistRecoveryNow: () => recovery.persistNow(),
    discardRecovery: () => recovery.discardRecovery()
  }
}
