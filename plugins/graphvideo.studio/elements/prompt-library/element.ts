import { LibraryBig } from 'lucide-react'
import { defineElement } from '@graphvideo/client-sdk'
import { PromptLibraryPanel } from './PromptLibraryPanel'

export default defineElement({
  register(context) {
    context.panels.register({
      id: 'prompt-library',
      title: '提示词库',
      icon: LibraryBig,
      component: PromptLibraryPanel,
    })
  },
})
