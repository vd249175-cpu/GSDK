export interface LaunchpadBatchResult {
  successCount: number
  failedCount: number
}

export function launchpadBatchCredits<T extends { estimatedCredits: number }>(
  items: readonly T[],
): number {
  return items.reduce((total, item) => total + item.estimatedCredits, 0)
}

export async function executeLaunchpadBatch<T>(
  items: readonly T[],
  execute: (item: T) => Promise<boolean>,
): Promise<LaunchpadBatchResult> {
  const results = await Promise.all(items.map((item) => execute(item)))
  const successCount = results.filter(Boolean).length
  return {
    successCount,
    failedCount: results.length - successCount,
  }
}
