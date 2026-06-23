import { createNowPlayingBridge } from "../src/index.js"

// Throwaway driver: claims the Now Playing slot with a fixed track and logs the
// Control Center buttons. Run with `npx tsx examples/demo.ts`, then open Control
// Center — a "Hello / World" tile should appear and button presses should log here.
const bridge = await createNowPlayingBridge()

for (const event of ["play", "pause", "toggle", "next", "previous"] as const) {
  bridge.on(event, () => console.log(`event → ${event}`))
}

bridge.update({
  title: "Hello",
  artist: "World",
  album: "macos-nowplaying-bridge",
  duration: 240,
  elapsed: 0,
  rate: 1,
  state: "playing",
})

console.log("demo running — open Control Center. Ctrl-C to quit.")
