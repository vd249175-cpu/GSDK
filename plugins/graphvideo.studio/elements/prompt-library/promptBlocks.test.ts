// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { parsePromptBlocks, parsePromptDocument, serializePromptDocument } from './promptBlocks'

describe('prompt library XML blocks', () => {
  it('reads only prompt elements and does not interpret Markdown headings', () => {
    expect(parsePromptBlocks([
      '<prompts>',
      '  <prompt>分析项目。正文里的 ## 二级标题只是普通文字。</prompt>',
      '  <prompt>根据事实规划下一步。</prompt>',
      '</prompts>',
    ].join('\n'))).toEqual([
      { content: '分析项目。正文里的 ## 二级标题只是普通文字。' },
      { content: '根据事实规划下一步。' },
    ])
  })

  it('rejects legacy Markdown and unsupported XML structures', () => {
    expect(() => parsePromptDocument('## 分析\n检查项目')).toThrow('有效的 XML')
    expect(() => parsePromptDocument('<library><prompt>内容</prompt></library>')).toThrow('根标签')
    expect(() => parsePromptDocument('<prompts><title>标题</title></prompts>')).toThrow('只允许使用 <prompt>')
    expect(() => parsePromptDocument('<prompts>游离文字<prompt>内容</prompt></prompts>')).toThrow('只允许使用 <prompt>')
    expect(() => parsePromptDocument('<prompts><prompt><b>内容</b></prompt></prompts>')).toThrow('自然语言文本')
    expect(() => parsePromptDocument('<prompts><prompt> </prompt></prompts>')).toThrow('不能为空')
  })

  it('round-trips natural-language entries and XML-sensitive characters', () => {
    const document = {
      blocks: [
        { content: '先比较 A < B，再检查 C & D。' },
        { content: '第二段\n保留自然换行。' },
      ],
    }
    const serialized = serializePromptDocument(document)
    expect(serialized).toContain('A &lt; B')
    expect(serialized).toContain('C &amp; D')
    expect(parsePromptDocument(serialized)).toEqual(document)
  })

  it('serializes an empty library as a valid XML document', () => {
    expect(serializePromptDocument({ blocks: [] })).toBe('<prompts>\n</prompts>\n')
  })
})
