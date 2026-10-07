import type { UIMessage } from 'ai'
import { ref, shallowRef } from 'vue'

import { chatDocumentId, resolveChatDocumentId, type ChatDocumentEditor } from './document'
import { createConversationStore } from './idb'
import { restoreMessages } from './messages'
import { createHistoryPersistence } from './persistence'
import { createHistorySession } from './session'
import type {
  Conversation,
  ConversationMeta,
  ConversationStore,
  HistoryChat,
  HistoryRuntime
} from './types'

/** Coordinates document ownership and serialized public conversation actions. */
export function createConversationHistory<TChat extends HistoryChat>(
  runtime: HistoryRuntime<TChat>,
  store: ConversationStore = createConversationStore()
) {
  const current = shallowRef<Conversation | null>(null)
  const messages = shallowRef<UIMessage[]>([])
  const conversations = ref<ConversationMeta[]>([])
  const readOnly = ref(false)
  const busy = ref(false)
  let ownerRecoveryId: string | null = null
  // Weak, so the history does not keep a closed document's editor alive.
  let owner: WeakRef<ChatDocumentEditor> | null = null
  const closedEditors = new WeakSet<ChatDocumentEditor>()
  let operation: Promise<unknown> = Promise.resolve()
  const session = createHistorySession(() => runtime.resetChat())
  const { flush, storageError } = createHistoryPersistence({
    store,
    current,
    messages,
    readOnly,
    refresh,
    content: () => ({
      messages: session.chat?.messages ?? messages.value,
      interrupted: session.interrupted
    })
  })

  function serialize<T>(run: () => Promise<T>): Promise<T> {
    const next = operation.then(async () => {
      busy.value = true
      try {
        return await run()
      } finally {
        busy.value = false
      }
    })
    operation = next.catch(() => undefined)
    return next
  }

  async function refresh() {
    conversations.value = await store.list()
  }
  function detach() {
    return session.detach(flush)
  }

  function isCurrentEditor(editor: ChatDocumentEditor): boolean {
    return runtime.getEditor() === editor && !closedEditors.has(editor)
  }

  async function activate(
    conversation: Conversation,
    editor: ChatDocumentEditor
  ): Promise<boolean> {
    if (!isCurrentEditor(editor)) return false
    if (conversation.messages.length || conversation.titleSource !== 'fallback') {
      await store.select(conversation.documentId, conversation.id)
      if (!isCurrentEditor(editor)) return false
    }
    owner = new WeakRef(editor)
    ownerRecoveryId = editor.getRecoveryId()
    session.restoreInterrupted(conversation.interrupted)
    readOnly.value = conversation.documentId !== chatDocumentId(editor)
    current.value = conversation
    messages.value = restoreMessages(conversation.messages)
    return true
  }

  async function createDraft(editor: ChatDocumentEditor): Promise<boolean> {
    if (!isCurrentEditor(editor)) return false
    const documentId = await resolveChatDocumentId(editor, store)
    if (!isCurrentEditor(editor)) return false
    const now = new Date().toISOString()
    const activated = await activate(
      {
        id: crypto.randomUUID(),
        documentId,
        documentName: editor.state.documentName,
        title: '',
        titleSource: 'fallback',
        createdAt: now,
        updatedAt: now,
        profileId: runtime.profileId(),
        backend: runtime.backend(),
        interrupted: false,
        messages: []
      },
      editor
    )
    if (!activated) return false
    await refresh()
    return isCurrentEditor(editor)
  }

  function isIdentityChange(editor: ChatDocumentEditor, documentId: string) {
    return (
      owner?.deref() === editor &&
      ownerRecoveryId === editor.getRecoveryId() &&
      current.value &&
      !readOnly.value &&
      current.value.documentId !== documentId
    )
  }

  async function reassignDocument(editor: ChatDocumentEditor, documentId: string) {
    if (!current.value) return
    await flush()
    if (!isCurrentEditor(editor)) return
    await store.reassignDocument(current.value.documentId, documentId, editor.state.documentName)
    current.value = { ...current.value, documentId, documentName: editor.state.documentName }
    await refresh()
  }

  async function loadDocument(editor: ChatDocumentEditor): Promise<boolean> {
    if (!isCurrentEditor(editor)) return false
    const documentId = await resolveChatDocumentId(editor, store)
    if (!isCurrentEditor(editor)) return false
    if (isIdentityChange(editor, documentId)) await reassignDocument(editor, documentId)
    if (!isCurrentEditor(editor)) return false
    if (current.value?.documentId === documentId && owner?.deref() === editor) {
      readOnly.value = false
      owner = new WeakRef(editor)
      ownerRecoveryId = editor.getRecoveryId()
      return true
    }
    await detach()
    if (!isCurrentEditor(editor)) return false
    const id = await store.getSelected(documentId)
    if (!isCurrentEditor(editor)) return false
    const conversation = id ? await store.read(id) : null
    if (!isCurrentEditor(editor)) return false
    if (conversation?.documentId === documentId) {
      if (!(await activate(conversation, editor))) return false
    } else if (!(await createDraft(editor))) return false
    await refresh()
    return isCurrentEditor(editor)
  }

  function ensureChat() {
    const editor = runtime.getEditor()
    return serialize(async () => {
      if (!isCurrentEditor(editor)) return null
      if (readOnly.value && owner?.deref() === editor) return null
      if (!(await loadDocument(editor))) return null
      if (readOnly.value || owner?.deref() !== editor) return null
      // A restored transcript does not restore an external agent session.
      if (
        current.value?.messages.length &&
        !session.chat &&
        (runtime.backend() !== 'direct' || current.value.backend !== 'direct')
      )
        return null
      if (!isCurrentEditor(editor)) return null
      const next = await runtime.ensureChat(messages.value, current.value?.id)
      if (!isCurrentEditor(editor)) {
        await next?.stop()
        await runtime.resetChat()
        return null
      }
      if (next) session.attach(next, flush)
      return next
    })
  }

  function initialize() {
    const editor = runtime.getEditor()
    return serialize(async () => {
      await loadDocument(editor)
    })
  }
  /** Await before disposing a document. Failed persistence leaves it open and retryable. */
  function releaseEditor(editor: ChatDocumentEditor): Promise<void> {
    // Block queued/late initialization immediately, before the serialized detach runs.
    closedEditors.add(editor)
    return serialize(async () => {
      if (owner?.deref() !== editor) return
      await detach()
      owner = null
      ownerRecoveryId = null
      current.value = null
      messages.value = []
    }).catch((error: unknown) => {
      closedEditors.delete(editor)
      throw error
    })
  }
  function cancelEditorClose(editor: ChatDocumentEditor): void {
    closedEditors.delete(editor)
  }
  function newChat() {
    const editor = runtime.getEditor()
    return serialize(async () => {
      if (!isCurrentEditor(editor)) return
      await detach()
      await createDraft(editor)
    })
  }
  function open(id: string) {
    const editor = runtime.getEditor()
    return serialize(async () => {
      if (!isCurrentEditor(editor)) return
      if (current.value?.id === id) return
      await detach()
      if (!isCurrentEditor(editor)) return
      const conversation = await store.read(id)
      if (conversation) await activate(conversation, editor)
    })
  }
  function rename(id: string, title: string) {
    return serialize(async () => {
      if (current.value?.id === id && current.value.messages.length === 0 && title.trim()) {
        current.value = { ...current.value, title: title.trim(), titleSource: 'manual' }
        await flush()
      }
      await store.rename(id, title)
      if (current.value?.id === id && title.trim())
        current.value = { ...current.value, title: title.trim(), titleSource: 'manual' }
      await refresh()
    })
  }
  function remove(id: string) {
    const editor = runtime.getEditor()
    return serialize(async () => {
      if (current.value?.id === id) {
        await detach()
        current.value = null
        messages.value = []
      }
      await store.remove(id)
      if (!current.value) await createDraft(editor)
      await refresh()
    })
  }

  return {
    current,
    messages,
    conversations,
    readOnly,
    busy,
    storageError,
    initialize,
    releaseEditor,
    cancelEditorClose,
    ensureChat,
    flush,
    newChat,
    open,
    rename,
    remove
  }
}
