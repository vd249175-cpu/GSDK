import { SlidersHorizontal } from 'lucide-react'
import './properties.css'
import { defineElement } from '@graphvideo/client-sdk'
import { PropertiesPanel } from './PropertiesPanel'

export default defineElement({
  register(context) {
    context.states.define({
      id: 'sections',
      scope: 'instance',
      initialValue: {} as Record<string, boolean>,
    })
    context.panels.register({
      id: 'properties',
      title: '节点属性',
      icon: SlidersHorizontal,
      component: PropertiesPanel,
    })
  },
})
