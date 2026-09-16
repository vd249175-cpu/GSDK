import { Sparkles, Rocket } from 'lucide-react'
import './generation.css'
import { defineElement } from '@graphvideo/client-sdk'
import { GenerationPanel } from './GenerationPanel'
import { LaunchpadPanel } from './LaunchpadPanel'

export default defineElement({
  register(context) {
    context.states.define({
      id: 'sections',
      scope: 'instance',
      initialValue: { prompt: true, text: true, media: true },
    })
    context.states.define({
      id: 'collapsed',
      scope: 'workspace',
      initialValue: [] as string[],
    })
    context.panels.register({
      id: 'generation',
      title: '生成准备',
      icon: Sparkles,
      component: GenerationPanel,
    })
  },
})
