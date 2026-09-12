import React from 'react'
import type { InspectItemData } from '../types'

export interface IslandItemsBarProps {
  items: InspectItemData[]
  selectedItem: InspectItemData | null
  onSelectItem: (item: InspectItemData) => void
}

export const IslandItemsBar: React.FC<IslandItemsBarProps> = ({ items, selectedItem, onSelectItem }) => {
  if (items.length === 0) return null

  return (
    <div className="island-items-bar">
      <span className="items-bar-label">🏝️ 岛民与生态物品:</span>
      <div className="items-chips-scroll">
        {items.map((item) => (
          <button
            key={item.id}
            className={`item-chip ${selectedItem?.id === item.id ? 'active' : ''}`}
            onClick={() => onSelectItem(item)}
            title="点击查看该生态要素/村民对应的私有状态字段"
          >
            <span>{item.itemIcon}</span>
            <span>{item.itemName}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
