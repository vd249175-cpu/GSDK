import { useSyncExternalStore } from 'react'
import { useWorkbenchServices } from '../context/WorkbenchHostContext'
import type { ExtensionProps } from './types'

export function ExtensionSlot({
  point,
  className,
  ...props
}: ExtensionProps & { point: string; className?: string }) {
  const { extensions } = useWorkbenchServices()
  useSyncExternalStore(extensions.subscribe, extensions.getSnapshot)
  const contributions = extensions.list(point)
  if (contributions.length === 0) return null
  return (
    <div className={className}>
      {contributions.map((extension) => {
        const Component = extension.component
        return <Component {...props} key={extension.id} />
      })}
    </div>
  )
}
