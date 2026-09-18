export interface PromptBlock {
  content: string
}

export interface PromptDocument {
  blocks: PromptBlock[]
}

const ROOT_TAG = 'prompts'
const BLOCK_TAG = 'prompt'

function parseXml(source: string) {
  const parsed = new DOMParser().parseFromString(source, 'application/xml')
  const parserError = parsed.getElementsByTagName('parsererror')[0]
  if (parserError) throw new Error('提示词文件不是有效的 XML')
  return parsed
}

export function parsePromptDocument(source: string): PromptDocument {
  const parsed = parseXml(source)
  const root = parsed.documentElement
  if (root.tagName !== ROOT_TAG) throw new Error(`提示词 XML 根标签必须是 <${ROOT_TAG}>`)

  const blocks: PromptBlock[] = []
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) continue
    if (node.nodeType !== Node.ELEMENT_NODE) {
      throw new Error(`<${ROOT_TAG}> 中只允许使用 <${BLOCK_TAG}> 标签`)
    }
    const child = node as Element
    if (child.tagName !== BLOCK_TAG) {
      throw new Error(`<${ROOT_TAG}> 中只允许使用 <${BLOCK_TAG}> 标签`)
    }
    if (child.children.length > 0) {
      throw new Error(`<${BLOCK_TAG}> 中只允许填写自然语言文本`)
    }
    const content = child.textContent?.trim() ?? ''
    if (!content) throw new Error(`<${BLOCK_TAG}> 不能为空`)
    blocks.push({ content })
  }
  return { blocks }
}

export function parsePromptBlocks(source: string): PromptBlock[] {
  return parsePromptDocument(source).blocks
}

function escapeXmlText(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function serializePromptDocument(document: PromptDocument) {
  const entries = document.blocks.map((block) => (
    `  <${BLOCK_TAG}>\n${escapeXmlText(block.content.trim())}\n  </${BLOCK_TAG}>`
  ))
  const body = entries.length > 0 ? `${entries.join('\n')}\n` : ''
  return `<${ROOT_TAG}>\n${body}</${ROOT_TAG}>\n`
}
