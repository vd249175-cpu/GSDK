import { useEffect, useState } from 'react'
import { useApplicationClient } from '../../app/AppContext'

export function useProjectAssetUrl(nodeId: string, versionId: string | null) {
  const application = useApplicationClient()
  const key = `${nodeId}:${versionId ?? ''}`
  const [result, setResult] = useState({ key: '', source: '', error: '' })
  useEffect(() => {
    let active = true
    if (!versionId) return () => { active = false }
    void application.assets.url(nodeId, versionId)
      .then((source) => { if (active) setResult({ key, source, error: '' }) })
      .catch((error: unknown) => {
        if (!active) return
        const message = error instanceof Error ? error.message : '本地媒体资源解析失败'
        console.error('[ProjectAssetUrl]', { nodeId, versionId, message })
        setResult({ key, source: '', error: message })
      })
    return () => { active = false }
  }, [application, key, nodeId, versionId])
  return result.key === key ? result : { key, source: '', error: '' }
}
