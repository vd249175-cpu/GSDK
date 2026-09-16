import { Braces } from 'lucide-react'
import { defineElement } from '@graphvideo/client-sdk'
import { MarkdownEditorPanel } from './MarkdownEditorPanel'

export default defineElement({
  register(context) {
    context.panels.register({
      id: 'markdown-editor',
      title: 'Markdown Logic',
      icon: Braces,
      component: MarkdownEditorPanel,
    })
  },
})
