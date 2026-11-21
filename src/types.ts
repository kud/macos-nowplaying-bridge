export type NowPlayingInfo = {
  title: string
  artist?: string
  album?: string
  artworkUrl?: string
  duration?: number
  elapsed?: number
  rate?: number
  state?: "playing" | "paused"
}

export type RemoteEvent = "play" | "pause" | "toggle" | "next" | "previous"

export type NowPlayingBridge = {
  update: (info: NowPlayingInfo) => void
  on: (event: RemoteEvent, handler: () => void) => void
  stop: () => void
}
