export type SpeechRange = { startMs: number; endMs: number }
export type PreparedTranscriptionAudio = {
  speechRanges: SpeechRange[]
  transcriptionBytes: Uint8Array
  transcriptionFormat: 'wav'
}

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

export function encodeMonoPcm16Wav(
  channels: readonly Float32Array[],
  inputRate: number,
  outputRate = 16_000,
): Uint8Array {
  if (!channels.length || inputRate <= 0 || outputRate <= 0) throw new Error('Invalid decoded audio')
  const inputLength = channels[0].length
  const outputLength = Math.max(1, Math.round(inputLength * outputRate / inputRate))
  const bytes = new Uint8Array(44 + outputLength * 2)
  const view = new DataView(bytes.buffer)
  const label = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index)
  }
  label(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); label(8, 'WAVE')
  label(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, 1, true); view.setUint32(24, outputRate, true)
  view.setUint32(28, outputRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  label(36, 'data'); view.setUint32(40, outputLength * 2, true)
  for (let index = 0; index < outputLength; index += 1) {
    const source = index * inputRate / outputRate
    const left = Math.min(inputLength - 1, Math.floor(source))
    const right = Math.min(inputLength - 1, left + 1)
    const fraction = source - left
    let sample = 0
    for (const channel of channels) sample += (channel[left] ?? 0) * (1 - fraction) + (channel[right] ?? 0) * fraction
    sample = Math.max(-1, Math.min(1, sample / channels.length))
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return bytes
}

export async function prepareWebmTranscription(bytes: Uint8Array): Promise<PreparedTranscriptionAudio> {
  const context = new AudioContext()
  try {
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const decoded = await context.decodeAudioData(copy)
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index))
    return {
      speechRanges: detectSpeechRanges(channels, decoded.sampleRate),
      transcriptionBytes: encodeMonoPcm16Wav(channels, decoded.sampleRate),
      transcriptionFormat: 'wav',
    }
  } finally {
    await context.close()
  }
}
