import { describe, expect, it } from 'vitest'
import { detectSpeechRanges } from './speechRanges'

describe('speech pause detection', () => {
  it('keeps separate utterances apart across quiet intervals', () => {
    const sampleRate = 1000
    const samples = new Float32Array(25 * sampleRate)
    for (const [start, end] of [[5.5, 8.1], [12.4, 16.2], [20.1, 24.7]]) {
      for (let index = start * sampleRate; index < end * sampleRate; index += 1) samples[index] = 0.15
    }
    const ranges = detectSpeechRanges([samples], sampleRate)
    expect(ranges).toHaveLength(3)
    expect(ranges.map((range) => range.startMs)).toEqual([5420, 12320, 20020])
    expect(ranges.map((range) => range.endMs)).toEqual([8180, 16280, 24780])
  })

  it('ignores brief noise after the spoken sentences', () => {
    const samples = new Float32Array(20_000)
    for (const [start, end] of [[0, 3600], [4280, 6060], [6680, 9540], [10780, 15320], [16960, 17200], [19000, 19220]]) {
      for (let index = start; index < end; index += 1) samples[index] = 0.15
    }
    expect(detectSpeechRanges([samples], 1000)).toHaveLength(4)
  })
})
