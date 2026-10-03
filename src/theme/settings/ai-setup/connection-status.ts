export default {
  slots: {
    root: 'inline-flex shrink-0 items-center gap-1.5 text-[11px] text-muted',
    dot: 'size-1.5 rounded-full bg-muted data-[status=connected]:bg-success data-[status=ready]:bg-success data-[status=starting]:bg-warning-action data-[status=sign-in]:bg-warning-action data-[status=unavailable]:bg-error'
  }
}
