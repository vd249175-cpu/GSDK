export function parseAgentSeatCount(value, name, maximum, fallback) {
  if (value === undefined || value === null) return fallback
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`)
  }
  return value
}

export function agentToolSeatsFromRun(parsed, instanceId = 'agent') {
  const instance = parsed?.graph?.instances?.find((entry) => entry.id === instanceId)
  return parseAgentSeatCount(instance?.params?.toolSeats, 'toolSeats', 32, 8)
}
