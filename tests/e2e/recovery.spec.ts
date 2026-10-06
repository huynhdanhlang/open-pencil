import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

test('isolated recovery preserves unopened FIG pages and releases its worker', async ({
  browser,
  baseURL
}) => {
  const context = await browser.newContext({ baseURL })
  await context.addInitScript(() => {
    window.showSaveFilePicker = async () =>
      (await navigator.storage.getDirectory()).getFileHandle('lazy-owned.fig', { create: true })
    const NativeWorker = window.Worker
    const stats = { started: 0, active: 0 }
    Object.defineProperty(window, '__recoveryWorkerStats', { value: stats })
    window.Worker = class extends NativeWorker {
      private counted = false
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.counted = String(url).includes('isolated-export-worker')
        if (this.counted) {
          stats.started++
          stats.active++
        }
      }
      terminate() {
        if (this.counted) {
          this.counted = false
          stats.active--
        }
        super.terminate()
      }
    }
  })
  const page = await context.newPage()
  await page.goto('/')
  await new CanvasHelper(page).waitForInit()
  const result = await page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('Store missing')
    const first = store.createShape('RECTANGLE', 20, 40, 120, 80)
    store.updateNode(first, { name: 'Saved first page' })
    const later = store.graph.addPage('Unopened original page')
    store.graph.createNode('RECTANGLE', later.id, {
      name: 'Preserved unopened content',
      width: 180,
      height: 90
    })
    if (!(await store.saveFigFileAs())) throw new Error('Owned Save failed')
    const handle = await (await navigator.storage.getDirectory()).getFileHandle('lazy-owned.fig')
    await store.openFigFile(
      new File([await (await handle.getFile()).arrayBuffer()], 'lazy-owned.fig'),
      handle
    )
    const pending = store.graph.getPages().find((p) => p.name === 'Unopened original page')
    if (!pending || store.graph.getChildren(pending.id).length !== 0)
      throw new Error('Expected a genuinely unopened page')
    const live = store.graph
      .getChildren(store.state.currentPageId)
      .find((n) => n.name === 'Saved first page')
    if (!live) throw new Error('Loaded node missing')
    store.updateNode(live.id, { name: 'Unsaved isolated first-page edit' })
    await store.persistRecoveryNow()
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('open-pencil-recovery')
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    const tx = db.transaction(['meta', 'fig'])
    const get = <T>(r: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      })
    const rows = await get(tx.objectStore('meta').getAll())
    if (rows.length !== 1) throw new Error('Owned recovery draft missing')
    const bytes = (await get(tx.objectStore('fig').get(rows[0].id))) as Uint8Array
    db.close()
    const liveStillPending = store.graph.getChildren(pending.id).length === 0
    await store.openFigFile(new File([Uint8Array.from(bytes)], 'isolated-restored.fig'))
    const editRetained = store.graph
      .getChildren(store.state.currentPageId)
      .some((n) => n.name === 'Unsaved isolated first-page edit')
    const restoredPage = store.graph.getPages().find((p) => p.name === 'Unopened original page')
    if (!restoredPage) throw new Error('Unopened page lost during recovery')
    await store.switchPage(restoredPage.id)
    const pendingRetained = store.graph
      .getChildren(restoredPage.id)
      .some((n) => n.name === 'Preserved unopened content')
    const stats = (
      window as typeof window & { __recoveryWorkerStats: { started: number; active: number } }
    ).__recoveryWorkerStats
    return { liveStillPending, editRetained, pendingRetained, ...stats }
  })
  expect(result).toMatchObject({
    liveStillPending: true,
    editRetained: true,
    pendingRetained: true,
    active: 0
  })
  expect(result.started).toBeGreaterThan(0)
  await context.close()
})

test('recovers unsaved writable FIG edits with autosave off and cleans the adopted draft on Save', async ({
  browser,
  baseURL
}) => {
  const context = await browser.newContext({ baseURL })
  await context.addInitScript(() => {
    // Use a real origin-private writable file; only the OS picker is bypassed.
    window.showSaveFilePicker = async () =>
      (await navigator.storage.getDirectory()).getFileHandle('owned-recovery.fig', { create: true })
  })
  const page = await context.newPage()
  await page.goto('/')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  const original = await page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('Store missing')
    const id = store.createShape('RECTANGLE', 40, 60, 220, 140)
    store.updateNode(id, { name: 'Saved writable boundary' })
    if (!(await store.saveFigFileAs())) throw new Error('Owned Save failed')
    if (store.state.autosaveEnabled) throw new Error('Autosave must be off')
    const file = await (await navigator.storage.getDirectory()).getFileHandle('owned-recovery.fig')
    const checksum = async () =>
      Array.from(
        new Uint8Array(
          await crypto.subtle.digest('SHA-256', await (await file.getFile()).arrayBuffer())
        )
      )
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    const sha = await checksum()
    for (let i = 0; i < 64; i++) store.updateNode(id, { name: 'Unsaved revision ' + i })
    store.updateNode(id, { name: 'Recovered writable draft' })
    await store.persistRecoveryNow()
    if ((await checksum()) !== sha) throw new Error('Recovery changed canonical file bytes')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('open-pencil-recovery')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const tx = db.transaction(['meta', 'fig'])
    const get = <T>(request: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    const rows = await get(tx.objectStore('meta').getAll())
    if (rows.length !== 1) throw new Error('Exactly one durable draft required')
    const bytes = (await get(tx.objectStore('fig').get(rows[0].id))) as Uint8Array
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength !== rows[0].byteLength ||
      rows[0].sceneVersion !== store.state.sceneVersion
    )
      throw new Error('Recovery metadata/FIG mismatch')
    db.close()
    return { sha, version: rows[0].sceneVersion }
  })
  page.once('dialog', (dialog) => dialog.accept())
  await page.reload()
  await expect(page.getByRole('alertdialog', { name: 'Recover unsaved work' })).toBeVisible()
  await page.getByRole('button', { name: 'Restore' }).click()
  await expect(page.getByText('Recovered writable draft')).toBeVisible()
  const saved = await page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('Restored store missing')
    const version = store.state.sceneVersion
    if (!(await store.saveFigFileAs())) throw new Error('Restored Save failed')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('open-pencil-recovery')
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    const tx = db.transaction('meta')
    const count = await new Promise<number>((resolve, reject) => {
      const r = tx.objectStore('meta').count()
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    db.close()
    const handle = await (
      await navigator.storage.getDirectory()
    ).getFileHandle('owned-recovery.fig')
    const sha = Array.from(
      new Uint8Array(
        await crypto.subtle.digest('SHA-256', await (await handle.getFile()).arrayBuffer())
      )
    )
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return { count, version, sha }
  })
  expect(saved.version).toBeLessThan(original.version)
  expect(saved.count).toBe(0)
  expect(saved.sha).not.toBe(original.sha)
  await context.close()
})

test('keeps recovery independent from cancelling an unsaved-document close', async ({
  browser,
  baseURL
}) => {
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()
  await page.goto('/')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  await page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const id = store.createShape('RECTANGLE', 120, 120, 240, 140)
    await store.persistRecoveryNow()
    store.updateNode(id, { name: 'Retained recovery rectangle' })
    await store.persistRecoveryNow()
  })

  await page.keyboard.press('ControlOrMeta+t')
  await expect(page.getByTestId('tabbar-tab')).toHaveCount(2)
  await page.locator('[data-slot="tab-item"]').first().getByTestId('tabbar-close').click()
  await expect(page.getByRole('alertdialog', { name: /Save changes to/ })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByTestId('tabbar-tab')).toHaveCount(2)
  await expect(page.getByTestId('recent-files-home')).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const request = indexedDB.open('open-pencil-recovery')
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const transaction = database.transaction('meta')
        const countRequest = transaction.objectStore('meta').count()
        return new Promise<number>((resolve, reject) => {
          countRequest.onsuccess = () => resolve(countRequest.result)
          countRequest.onerror = () => reject(countRequest.error)
        })
      })
    )
    .toBe(1)

  page.once('dialog', (dialog) => dialog.accept())
  await page.reload()
  await expect(page.getByRole('alertdialog', { name: 'Recover unsaved work' })).toBeVisible()
  await page.getByRole('button', { name: 'Restore' }).click()
  await expect(page.getByText('Retained recovery rectangle')).toBeVisible()

  await context.close()
})
