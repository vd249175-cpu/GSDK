import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'

const minimumFloatingThumbSize = 24
const hideDelay = 700

interface ScrollSnapshot {
  target: HTMLElement
  top: number
  left: number
  width: number
  height: number
  clientWidth: number
  clientHeight: number
  scrollWidth: number
  scrollHeight: number
  scrollLeft: number
  scrollTop: number
}

interface DragState {
  axis: 'horizontal' | 'vertical'
  target: HTMLElement
  startPointer: number
  startScroll: number
  scrollRange: number
  thumbRange: number
}

export function calculateFloatingThumb(
  trackSize: number,
  viewportSize: number,
  contentSize: number,
  scrollOffset: number,
) {
  if (trackSize <= 0 || viewportSize <= 0 || contentSize <= viewportSize) return null
  const size = Math.min(trackSize, Math.max(minimumFloatingThumbSize, trackSize * viewportSize / contentSize))
  const scrollRange = contentSize - viewportSize
  const thumbRange = trackSize - size
  const offset = scrollRange > 0 ? thumbRange * scrollOffset / scrollRange : 0
  return { offset, size, scrollRange, thumbRange }
}

function readSnapshot(target: HTMLElement): ScrollSnapshot | null {
  if (!target.isConnected) return null
  const rect = target.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return {
    target,
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    clientWidth: target.clientWidth,
    clientHeight: target.clientHeight,
    scrollWidth: target.scrollWidth,
    scrollHeight: target.scrollHeight,
    scrollLeft: target.scrollLeft,
    scrollTop: target.scrollTop,
  }
}

export function FloatingScrollbars({ ownerDocument = document }: { ownerDocument?: Document }) {
  const ownerWindow = ownerDocument.defaultView ?? window
  const [snapshot, setSnapshot] = useState<ScrollSnapshot | null>(null)
  const hideTimer = useRef<number | null>(null)
  const drag = useRef<DragState | null>(null)

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current === null) return
    ownerWindow.clearTimeout(hideTimer.current)
    hideTimer.current = null
  }, [ownerWindow])

  const scheduleHide = useCallback(() => {
    clearHideTimer()
    hideTimer.current = ownerWindow.setTimeout(() => {
      if (!drag.current) setSnapshot(null)
    }, hideDelay)
  }, [clearHideTimer, ownerWindow])

  const update = useCallback((target: HTMLElement) => {
    const next = readSnapshot(target)
    if (!next || (next.scrollHeight <= next.clientHeight && next.scrollWidth <= next.clientWidth)) return
    setSnapshot(next)
    scheduleHide()
  }, [scheduleHide])

  useEffect(() => {
    function onScroll(event: Event) {
      if (event.target instanceof HTMLElement) update(event.target)
    }
    function onResize() {
      if (snapshot?.target) update(snapshot.target)
    }
    ownerDocument.addEventListener('scroll', onScroll, true)
    ownerWindow.addEventListener('resize', onResize)
    return () => {
      ownerDocument.removeEventListener('scroll', onScroll, true)
      ownerWindow.removeEventListener('resize', onResize)
      clearHideTimer()
    }
  }, [clearHideTimer, ownerDocument, ownerWindow, snapshot?.target, update])

  if (!snapshot) return null
  const vertical = calculateFloatingThumb(
    snapshot.height, snapshot.clientHeight, snapshot.scrollHeight, snapshot.scrollTop,
  )
  const horizontal = calculateFloatingThumb(
    snapshot.width, snapshot.clientWidth, snapshot.scrollWidth, snapshot.scrollLeft,
  )

  function beginDrag(
    axis: DragState['axis'],
    event: ReactPointerEvent<HTMLDivElement>,
    thumb: NonNullable<ReturnType<typeof calculateFloatingThumb>>,
  ) {
    clearHideTimer()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      axis,
      target: snapshot!.target,
      startPointer: axis === 'vertical' ? event.clientY : event.clientX,
      startScroll: axis === 'vertical' ? snapshot!.scrollTop : snapshot!.scrollLeft,
      scrollRange: thumb.scrollRange,
      thumbRange: thumb.thumbRange,
    }
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current || current.thumbRange <= 0) return
    const pointer = current.axis === 'vertical' ? event.clientY : event.clientX
    const next = current.startScroll + (pointer - current.startPointer) * current.scrollRange / current.thumbRange
    if (current.axis === 'vertical') current.target.scrollTop = next
    else current.target.scrollLeft = next
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    drag.current = null
    scheduleHide()
  }

  return createPortal(
    <div className="floating-scrollbars" aria-hidden="true">
      {vertical && (
        <div
          className="floating-scrollbar-thumb is-vertical"
          style={{ left: snapshot.left + snapshot.width - 6, top: snapshot.top + vertical.offset, height: vertical.size }}
          onPointerDown={(event) => beginDrag('vertical', event, vertical)}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      )}
      {horizontal && (
        <div
          className="floating-scrollbar-thumb is-horizontal"
          style={{ left: snapshot.left + horizontal.offset, top: snapshot.top + snapshot.height - 6, width: horizontal.size }}
          onPointerDown={(event) => beginDrag('horizontal', event, horizontal)}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      )}
    </div>,
    ownerDocument.body,
  )
}
