import { ListTree } from 'lucide-react'
import './outliner.css'
import { defineElement, type ProjectTreeClipboardItem } from '@graphvideo/client-sdk'
import { OutlinerPanel } from './OutlinerPanel'

export default defineElement({
  register(context) {
    context.states.define({ id: 'filter', scope: 'workspace', initialValue: '' })
    context.states.define({ id: 'collapsed', scope: 'workspace', initialValue: [] as string[] })
    context.states.define({ id: 'focusedKey', scope: 'project', initialValue: '' })
    context.states.define({
      id: 'clipboard', scope: 'project', initialValue: null as ProjectTreeClipboardItem | null,
    })
    context.panels.register({
      id: 'outliner',
      title: '项目目录',
      icon: ListTree,
      component: OutlinerPanel,
    })
  },
})
