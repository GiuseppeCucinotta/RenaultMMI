import { EventEmitter } from 'node:events'

export interface EntertainmentVolumeState {
  volume: number
  activeSourceId: string
}

interface VolumeBackend {
  apply(percent: number): Promise<void>
}

const VOLUME_MIN = 0
const VOLUME_MAX = 30
const VOLUME_DEFAULT = 25

function percentFromEntertainment(volume: number): number {
  return Math.round((volume / VOLUME_MAX) * 100)
}

/**
 * The entertainment volume is applied ONLY to the audio path of the currently
 * active entertainment source. It never touches the system output (master/PCM),
 * so unrelated sounds (parking sensors, alerts, navigation, ...) keep their own
 * independent volume. Every real source registers its own stream backend below.
 */
class ServiceVolumeBackend implements VolumeBackend {
  private readonly baseUrl: string

  constructor(
    private readonly label: string,
    port: number,
  ) {
    this.baseUrl = `http://127.0.0.1:${port}`
  }

  async apply(percent: number): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/volume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volume: percent }),
      })
    } catch (error) {
      console.error(`[entertainment] failed to set ${this.label} volume:`, error instanceof Error ? error.message : error)
    }
  }
}

/** Fallback for sources whose audio stream is not wired up yet: change nothing system-wide. */
class NoopVolumeBackend implements VolumeBackend {
  async apply(): Promise<void> {
    // The source has no real stream yet (FM placeholder). A real backend is
    // registered in `sourceBackends` once the source produces audio.
  }
}

/**
 * Single source of truth for the 0-30 "Entertainment" volume. One global value
 * for every entertainment source: changing it (or switching sources) re-applies
 * the same value to the audio backend of the currently active source. System
 * volume is never modified: each source's backend only touches that source's
 * own stream.
 */
export class EntertainmentVolumeController extends EventEmitter {
  private volume: number
  private activeSourceId: string
  private readonly defaultBackend: VolumeBackend
  private readonly sourceBackends: Record<string, VolumeBackend>

  constructor(options: { jukeboxPort: number; bluetoothPort: number; cdPort: number; defaultSourceId: string }) {
    super()
    this.volume = VOLUME_DEFAULT
    this.activeSourceId = options.defaultSourceId
    this.defaultBackend = new NoopVolumeBackend()
    this.sourceBackends = {
      jukebox: new ServiceVolumeBackend('jukebox', options.jukeboxPort),
      bluetooth: new ServiceVolumeBackend('bluetooth', options.bluetoothPort),
      cd: new ServiceVolumeBackend('cd', options.cdPort),
    }
  }

  getState(): EntertainmentVolumeState {
    return { volume: this.volume, activeSourceId: this.activeSourceId }
  }

  setVolume(volume: number): EntertainmentVolumeState {
    this.volume = Math.max(VOLUME_MIN, Math.min(VOLUME_MAX, Math.round(volume)))
    void this.applyVolume()
    this.emit('state', this.getState())
    return this.getState()
  }

  setActiveSource(sourceId: string): EntertainmentVolumeState {
    this.activeSourceId = sourceId
    void this.applyVolume()
    this.emit('state', this.getState())
    return this.getState()
  }

  private async applyVolume(): Promise<void> {
    const backend = this.sourceBackends[this.activeSourceId] ?? this.defaultBackend
    try {
      await backend.apply(percentFromEntertainment(this.volume))
    } catch (error) {
      console.error('[entertainment] failed to apply volume:', error instanceof Error ? error.message : error)
    }
  }
}
