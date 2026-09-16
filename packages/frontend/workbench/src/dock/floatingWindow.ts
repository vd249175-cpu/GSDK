export interface FloatingDocument {
  container: HTMLDivElement
  disconnect(): void
}

export function isOutsideViewport(x: number, y: number, width: number, height: number) {
  return x <= 0 || y <= 0 || x >= width || y >= height
}

function copyStyles(targetDocument: Document) {
  targetDocument.head.querySelectorAll('[data-graphvideo-shared-style]').forEach((node) => node.remove())
  document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
    const clone = node.cloneNode(true) as HTMLElement
    clone.dataset.graphvideoSharedStyle = 'true'
    if (clone instanceof HTMLLinkElement && node instanceof HTMLLinkElement) clone.href = node.href
    targetDocument.head.append(clone)
  })
}

const sharedRootAttributes = ['class', 'data-theme', 'data-font-family', 'data-font-size']

export function synchronizeFloatingRoot(source: HTMLElement, target: HTMLElement) {
  sharedRootAttributes.forEach((attribute) => {
    const value = source.getAttribute(attribute)
    if (value === null) target.removeAttribute(attribute)
    else target.setAttribute(attribute, value)
  })
}

export function prepareFloatingWindow(popup: Window, title: string): FloatingDocument {
  const targetDocument = popup.document
  targetDocument.title = title
  synchronizeFloatingRoot(document.documentElement, targetDocument.documentElement)
  targetDocument.body.replaceChildren()
  targetDocument.body.className = 'floating-panel-body'
  const container = targetDocument.createElement('div')
  container.className = 'floating-panel-root'
  targetDocument.body.append(container)
  copyStyles(targetDocument)
  const styleObserver = new MutationObserver(() => copyStyles(targetDocument))
  styleObserver.observe(document.head, { childList: true, subtree: true, characterData: true })
  const rootObserver = new MutationObserver(() => (
    synchronizeFloatingRoot(document.documentElement, targetDocument.documentElement)
  ))
  rootObserver.observe(document.documentElement, { attributes: true })
  return {
    container,
    disconnect: () => {
      styleObserver.disconnect()
      rootObserver.disconnect()
    },
  }
}
