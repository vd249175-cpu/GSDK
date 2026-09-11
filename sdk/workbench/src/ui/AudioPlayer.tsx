import { Pause, Play } from 'lucide-react'
import { useRef, useState } from 'react'

function formatMediaTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00'
  const minutes = Math.floor(value / 60)
  const seconds = Math.floor(value % 60).toString().padStart(2, '0')
  return `${minutes}:${seconds}`
}

export function AudioPlayer({ source, label, className = '' }: {
  source: string
  label: string
  className?: string
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  async function togglePlayback() {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) await audio.play().catch(() => undefined)
    else audio.pause()
  }

  return (
    <div className={`custom-audio ${className}`.trim()}>
      <audio
        ref={audioRef}
        src={source}
        preload="metadata"
        onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <button type="button" aria-label={playing ? '暂停' : '播放'} title={playing ? '暂停' : '播放'} onClick={() => void togglePlayback()}>
        {playing ? <Pause size={13} /> : <Play size={13} />}
      </button>
      <strong title={label}>{label}</strong>
      <input
        type="range"
        aria-label="音频进度"
        min={0}
        max={duration || 0}
        step={0.01}
        value={Math.min(currentTime, duration || 0)}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (audioRef.current) audioRef.current.currentTime = next
          setCurrentTime(next)
        }}
      />
      <span>{formatMediaTime(currentTime)} / {formatMediaTime(duration)}</span>
    </div>
  )
}
