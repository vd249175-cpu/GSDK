export function newestSubtitlesFirst<T extends { startMs: number; endMs: number }>(subtitles: readonly T[]): T[] {
  return [...subtitles].sort((left, right) => right.startMs - left.startMs || right.endMs - left.endMs)
}
