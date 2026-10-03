export default {
  slots: {
    root: 'mx-auto flex w-full max-w-xl flex-col gap-5 rounded-xl border border-border bg-panel p-6 text-surface',
    heading: 'text-xl font-semibold tracking-tight',
    description: 'mt-2 text-sm leading-relaxed text-muted',
    features: 'mt-4 grid gap-x-4 gap-y-2 sm:grid-cols-2',
    feature: 'flex items-center gap-2 text-xs text-surface',
    featureIcon: 'size-3.5 shrink-0 text-muted',
    ai: 'rounded-lg border border-accent/25 bg-accent/5 p-4',
    aiHeader: 'flex flex-wrap items-center justify-between gap-2',
    aiHeading: 'text-sm font-semibold',
    capabilities: 'my-3 flex flex-col gap-2 text-xs leading-relaxed',
    guidance: 'text-xs leading-relaxed text-muted',
    actions: 'flex flex-wrap items-center justify-between gap-3',
    note: 'mt-2 text-[11px] text-muted'
  }
}
