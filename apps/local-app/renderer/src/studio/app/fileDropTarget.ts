type ClosestTarget = EventTarget & {
  closest?: (selector: string) => Element | null
}

export function isNestedFileDropTarget(target: EventTarget | null) {
  const candidate = target as ClosestTarget | null
  return typeof candidate?.closest === 'function'
    && Boolean(candidate.closest('[data-file-drop-target]'))
}
