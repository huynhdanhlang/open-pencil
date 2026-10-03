export default {
  slots: {
    root: 'mx-auto w-full max-w-2xl rounded-lg border border-border bg-panel p-5 text-xs text-surface',
    header: 'mb-4 flex items-center justify-between gap-3',
    heading: 'text-base font-semibold',
    body: 'flex flex-col gap-3',
    help: 'text-xs leading-relaxed text-muted',
    choice:
      'flex cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-3 transition-colors hover:bg-hover has-[[data-state=checked]]:border-accent has-[[data-state=checked]]:bg-accent/5 focus-within:ring-2 focus-within:ring-accent/50',
    row: 'flex flex-col gap-1 border-b border-border py-3 last:border-b-0'
  }
}
