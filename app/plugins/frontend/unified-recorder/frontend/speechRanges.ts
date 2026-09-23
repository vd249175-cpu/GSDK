export type SpeechRange = { startMs: number; endMs: number }

export function detectSpeechRanges(channels: readonly Float32Array[], sampleRate: number): SpeechRange[] {
  if (!channels.length || !Number.isFinite(sampleRate) || sampleRate <= 0) return []
  const frameSamples = Math.max(1, Math.round(sampleRate * 0.02))
  const frameMs = frameSamples * 1000 / sampleRate
  const frameCount = Math.ceil(channels[0].length / frameSamples)
  const levels: number[] = []
  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * frameSamples
    const end = Math.min(channels[0].length, start + frameSamples)
    let power = 0
    let count = 0
    for (let sample = start; sample < end; sample += 4) {
      let maximum = 0
      for (const channel of channels) maximum = Math.max(maximum, Math.abs(channel[sample] ?? 0))
      power += maximum * maximum
      count += 1
    }
    levels.push(count ? Math.sqrt(power / count) : 0)
  }
  const ranked = [...levels].sort((left, right) => left - right)
  const noiseFloor = ranked[Math.floor(ranked.length * 0.2)] ?? 0
  const threshold = Math.max(0.006, noiseFloor * 2.8)
  const maxGapFrames = Math.ceil(450 / frameMs)
  const ranges: SpeechRange[] = []
  let first = -1
  let last = -1
  for (let frame = 0; frame <= levels.length; frame += 1) {
    if (frame < levels.length && levels[frame] >= threshold) {
      if (first < 0) first = frame
      last = frame
    }
    if (first >= 0 && (frame === levels.length || frame - last > maxGapFrames)) {
      const startMs = Math.max(0, Math.round(first * frameMs - 80))
      const endMs = Math.round((last + 1) * frameMs + 80)
      if ((last - first + 1) * frameMs >= 350) ranges.push({ startMs, endMs })
      first = -1
      last = -1
    }
  }
  return ranges
}

export async function detectWebmSpeechRanges(bytes: Uint8Array): Promise<SpeechRange[]> {
  const context = new AudioContext()
  try {
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const decoded = await context.decodeAudioData(copy)
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index))
    return detectSpeechRanges(channels, decoded.sampleRate)
  } finally {
    await context.close()
  }
}
