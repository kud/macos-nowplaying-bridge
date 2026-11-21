import type { NowPlayingInfo } from "./types.js"

/** What the bridge remembers between updates to publish a correct rate. */
export type RateMemory = {
  /** Rate last published to Control Center. */
  rate: number
  /** Last non-zero rate, restored when playback resumes without an explicit rate. */
  playingRate: number
}

export const initialRateMemory: RateMemory = { rate: 1, playingRate: 1 }

/**
 * Resolve the playback rate to publish for an update. An explicit `rate` wins;
 * otherwise a `state` change implies one (paused stops the progress bar, playing
 * restores the last playing rate); otherwise the last published rate is kept.
 */
export const resolveRate = (
  memory: RateMemory,
  info: Pick<NowPlayingInfo, "rate" | "state">,
): RateMemory => {
  const rate =
    info.rate !== undefined
      ? info.rate
      : info.state === "paused"
        ? 0
        : info.state === "playing"
          ? memory.playingRate
          : memory.rate
  return { rate, playingRate: rate > 0 ? rate : memory.playingRate }
}
