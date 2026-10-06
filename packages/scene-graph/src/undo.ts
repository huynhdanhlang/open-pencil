export interface UndoEntry {
  label: string
  forward: () => void
  inverse: () => void
  coalesceKey?: string
}

export interface UndoManagerOptions {
  limit?: number
  /** Called after recording, undoing, redoing, or clearing committed history. */
  onChange?: () => void
}

interface UndoBatch {
  label: string
  entries: UndoEntry[]
  coalesceKey?: string
}

const DEFAULT_HISTORY_LIMIT = 200

export class UndoManager {
  private undoStack: UndoEntry[] = []
  private redoStack: UndoEntry[] = []
  private batches: UndoBatch[] = []
  private readonly limit: number
  private readonly onChange: (() => void) | undefined

  constructor(options: UndoManagerOptions = {}) {
    this.limit = options.limit ?? DEFAULT_HISTORY_LIMIT
    this.onChange = options.onChange
  }

  apply(entry: UndoEntry): void {
    this.execute(entry)
  }

  execute(entry: UndoEntry): void {
    try {
      entry.forward()
    } catch (error) {
      if (error instanceof CommittedGraphEventError) this.record(entry)
      throw error
    }
    this.record(entry)
  }

  push(entry: UndoEntry): void {
    this.record(entry)
  }

  record(entry: UndoEntry): void {
    const batch = this.currentBatch
    if (batch) {
      batch.entries.push(entry)
      return
    }
    this.pushUndoEntry(entry)
  }

  undo(): string | null {
    return this.replay(this.undoStack, this.redoStack, 'inverse')
  }

  redo(): string | null {
    return this.replay(this.redoStack, this.undoStack, 'forward')
  }

  beginBatch(label: string, coalesceKey?: string): void {
    this.batches.push({ label, entries: [], coalesceKey })
  }

  commitBatch(): void {
    const batch = this.batches.pop()
    if (!batch || batch.entries.length === 0) return

    const entry = this.createBatchEntry(batch)
    const parentBatch = this.currentBatch
    if (parentBatch) parentBatch.entries.push(entry)
    else this.pushUndoEntry(entry)
  }

  runBatch<T>(label: string, fn: () => T, coalesceKey?: string): T {
    this.beginBatch(label, coalesceKey)
    try {
      const result = fn()
      this.commitBatch()
      return result
    } catch (error) {
      if (error instanceof CommittedGraphEventError) this.commitBatch()
      else this.rollbackBatch()
      throw error
    }
  }

  rollbackBatch(): void {
    const batch = this.batches.pop()
    if (!batch) return
    createReplay(batch.entries.toReversed(), 'inverse')()
  }

  /** Abandon provisional history without replaying it or changing committed undo/redo entries. */
  discardBatches(): void {
    this.batches = []
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
    this.discardBatches()
    this.onChange?.()
  }

  get isBatching(): boolean {
    return this.batches.length > 0
  }

  get diagnostics() {
    return {
      undo: this.undoStack.length,
      redo: this.redoStack.length,
      batches: this.batches.length
    }
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /**
   * The entry `depth` steps below the top of the undo stack, so a caller that pushed entries
   * can tell whether they are still the most recent ones.
   */
  peekUndo(depth = 0): UndoEntry | undefined {
    return this.undoStack.at(-1 - depth)
  }

  /** The entry `depth` steps below the top of the redo stack, the next one Redo applies at 0. */
  peekRedo(depth = 0): UndoEntry | undefined {
    return this.redoStack.at(-1 - depth)
  }

  get undoLabel(): string | null {
    return this.undoStack.at(-1)?.label ?? null
  }

  get redoLabel(): string | null {
    return this.redoStack.at(-1)?.label ?? null
  }

  private get currentBatch(): UndoBatch | null {
    return this.batches.at(-1) ?? null
  }

  private createBatchEntry(batch: UndoBatch): UndoEntry {
    return {
      label: batch.label,
      forward: createReplay(batch.entries, 'forward'),
      inverse: createReplay(batch.entries.toReversed(), 'inverse'),
      coalesceKey: batch.coalesceKey
    }
  }

  private replay(
    from: UndoEntry[],
    to: UndoEntry[],
    direction: 'inverse' | 'forward'
  ): string | null {
    const entry = from.pop()
    if (!entry) return null
    let committed = false
    try {
      entry[direction]()
      committed = true
    } catch (error) {
      committed = error instanceof CommittedGraphEventError
      if (!committed) from.push(entry)
      throw error
    } finally {
      if (committed) {
        to.push(entry)
        this.onChange?.()
      }
    }
    return entry.label
  }

  private pushUndoEntry(entry: UndoEntry): void {
    const previous = this.undoStack.at(-1)
    if (entry.coalesceKey && previous?.coalesceKey === entry.coalesceKey) {
      this.undoStack[this.undoStack.length - 1] = {
        ...entry,
        inverse: previous.inverse
      }
    } else {
      this.undoStack.push(entry)
    }
    this.redoStack = []
    this.trimUndoStack()
    this.onChange?.()
  }

  private trimUndoStack(): void {
    if (!Number.isFinite(this.limit) || this.limit <= 0) return
    const overflow = this.undoStack.length - this.limit
    if (overflow > 0) this.undoStack.splice(0, overflow)
  }
}

function createReplay(entries: UndoEntry[], direction: 'inverse' | 'forward'): () => void {
  return () => {
    const errors: unknown[] = []
    const completed: UndoEntry[] = []
    for (const entry of entries) {
      try {
        entry[direction]()
      } catch (error) {
        if (!(error instanceof CommittedGraphEventError)) {
          const rollbackErrors: unknown[] = []
          for (const applied of completed.toReversed()) {
            try {
              applied[direction === 'inverse' ? 'forward' : 'inverse']()
            } catch (rollbackError) {
              rollbackErrors.push(rollbackError)
            }
          }
          if (rollbackErrors.length)
            throw new AggregateError(
              [error, ...errors, ...rollbackErrors],
              'History batch replay and recovery failed'
            )
          throw error
        }
        errors.push(error)
      }
      completed.push(entry)
    }
    if (errors.length) throw new CommittedGraphEventError(errors)
  }
}
import { CommittedGraphEventError } from './buffered-events'
