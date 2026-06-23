import { execFile, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const exec = promisify(execFile)

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

const sourcePath = fileURLToPath(
  new URL("../native/nowplaying-bridge.swift", import.meta.url),
)
const bundleDir = join(
  tmpdir(),
  "macos-nowplaying-bridge",
  "NowPlayingBridge.app",
)
const binaryPath = join(bundleDir, "Contents", "MacOS", "nowplaying-bridge")

const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>io.kud.macos-nowplaying-bridge</string>
  <key>CFBundleName</key><string>NowPlayingBridge</string>
  <key>CFBundleExecutable</key><string>nowplaying-bridge</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
`

// macOS only surfaces a process in Now Playing when it lives in a bundle with a
// CFBundleIdentifier, so the compiled binary is wrapped in a minimal .app before launch.
const ensureBundle = async (): Promise<string> => {
  if (existsSync(binaryPath)) return binaryPath
  await mkdir(dirname(binaryPath), { recursive: true })
  await exec("swiftc", [
    "-O",
    "-swift-version",
    "5",
    sourcePath,
    "-o",
    binaryPath,
  ])
  await writeFile(join(bundleDir, "Contents", "Info.plist"), infoPlist)
  return binaryPath
}

/**
 * Spawn a faceless macOS Now Playing bridge as a persistent co-process. Hand it
 * what is playing with `update()`, react to Control Center buttons with `on()`,
 * and tear it down with `stop()`. macOS only.
 */
export const createNowPlayingBridge = async (): Promise<NowPlayingBridge> => {
  if (process.platform !== "darwin") {
    throw new Error("@kud/macos-nowplaying-bridge only works on macOS")
  }

  const binary = await ensureBundle()
  const child = spawn(binary, { stdio: ["pipe", "pipe", "inherit"] })
  const handlers = new Map<RemoteEvent, Set<() => void>>()

  let buffer = ""
  child.stdout?.setEncoding("utf8")
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk
    let newline = buffer.indexOf("\n")
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) {
        try {
          const event = (JSON.parse(line) as { event?: RemoteEvent }).event
          if (event) handlers.get(event)?.forEach((handler) => handler())
        } catch {
          // ignore malformed lines
        }
      }
      newline = buffer.indexOf("\n")
    }
  })

  return {
    update: (info) => {
      child.stdin?.write(`${JSON.stringify(info)}\n`)
    },
    on: (event, handler) => {
      const set = handlers.get(event) ?? new Set()
      set.add(handler)
      handlers.set(event, set)
    },
    stop: () => {
      child.kill()
    },
  }
}
