import { Rocket } from 'lucide-react'
import type { PanelProps } from '@graphvideo/client-sdk'

export function LaunchpadPanel({ instanceId }: PanelProps) {
  return (
    <section className="panel panel-launchpad" data-instance-id={instanceId}>
      <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-secondary)' }}>
        <Rocket size={32} style={{ marginBottom: 12, opacity: 0.7, color: 'var(--accent)' }} />
        <h3 style={{ margin: '0 0 8px 0', fontSize: 14, color: 'var(--text)' }}>发射台功能已全面融合至【项目目录】</h3>
        <p style={{ margin: 0, fontSize: 12, lineHeight: '1.6' }}>
          多模态生成、分层流水线、全量发射、暂停终止与积分管理已统一部署在项目目录顶部控制条中。
        </p>
      </div>
    </section>
  )
}
