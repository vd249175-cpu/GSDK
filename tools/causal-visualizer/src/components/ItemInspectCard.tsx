import React from 'react'
import type { InspectItemData } from '../types'

export interface ItemInspectCardProps {
  item: InspectItemData
  onClose: () => void
}

export const ItemInspectCard: React.FC<ItemInspectCardProps> = ({ item, onClose }) => {
  return (
    <section className="item-inspect-card">
      <div className="inspect-header">
        <div className="inspect-title-group">
          <span className="inspect-big-icon">{item.itemIcon}</span>
          <div>
            <div className="inspect-title">{item.itemName}</div>
            <div className="inspect-category-row">
              <span className={`inspect-category-badge ${item.category}`}>
                {item.category === 'state_field' && '私有状态属性 (State Field)'}
                {item.category === 'change_villager' && '因果变迁实体 (Change Villager)'}
                {item.category === 'system_landmark' && '系统角色地标 (Landmark)'}
                {item.category === 'island_flora' && '海岛原生生态 (Flora & Fauna)'}
              </span>
            </div>
          </div>
        </div>
        <button className="inspect-close-btn" onClick={onClose} title="关闭字段卡片">×</button>
      </div>

      <div className="inspect-body">
        {item.stateKey && (
          <div className="inspect-field-card">
            <div className="inspect-field-header">
              <span className="field-label">字段名称 (State Key)</span>
              <span className="field-type">{item.valueType || typeof item.stateValue}</span>
            </div>
            <div className="inspect-field-key">{item.stateKey}</div>

            <div className="inspect-field-val-wrap">
              <div className="field-val-label">实时状态取值 (State Value)</div>
              {typeof item.stateValue === 'boolean' ? (
                <span className={`inspect-bool-badge ${item.stateValue ? 'true' : 'false'}`}>
                  {item.stateValue ? 'TRUE (真)' : 'FALSE (假)'}
                </span>
              ) : typeof item.stateValue === 'number' ? (
                <span className="inspect-num-badge">{item.stateValue}</span>
              ) : typeof item.stateValue === 'string' ? (
                <span className="inspect-str-badge">"{item.stateValue}"</span>
              ) : typeof item.stateValue === 'object' && item.stateValue !== null ? (
                <pre className="inspect-json-box">{JSON.stringify(item.stateValue, null, 2)}</pre>
              ) : (
                <span className="inspect-str-badge">{String(item.stateValue)}</span>
              )}
            </div>
          </div>
        )}

        <div className="inspect-desc-box">
          <div className="desc-text">{item.description}</div>
        </div>

        <div className="inspect-causal-tip">
          {item.category === 'state_field' && (
            <span>💡 <b>纯领域状态原则</b>：State 只能由 Owner Node 在当前 change ctx 中写入；外部节点只能通过发送 Info 请求变迁。</span>
          )}
          {item.category === 'change_villager' && (
            <span>💡 <b>因果变迁实体</b>：一个小岛上有多少 change 就有多少岛民。调度推进时岛民小步工作，收敛后欢欣跳跃。</span>
          )}
          {item.category === 'system_landmark' && (
            <span>💡 <b>物理隔离原则</b>：观察类（灯塔）与执行类（渔港）物理分离，观察节点零主动写，执行节点动作结算即离。</span>
          )}
          {item.category === 'island_flora' && (
            <span>💡 <b>图无关生态</b>：任何业务因果图导入后，均由原生状态和代次确定性派生体素生态。</span>
          )}
        </div>
      </div>
    </section>
  )
}
