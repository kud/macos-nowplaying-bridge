import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ensureHelper, helperBinaryPath, helperCacheKey } from "../src/cache.js"

describe("helper cache key", () => {
  it("is stable for identical source", () => {
    expect(helperCacheKey("print(1)")).toBe(helperCacheKey("print(1)"))
    expect(helperCacheKey("print(1)")).toBe(
      helperCacheKey(Buffer.from("print(1)")),
    )
    expect(helperCacheKey("x")).toMatch(/^[0-9a-f]{16}$/)
  })

  it("changes when the source changes, forcing a rebuild after upgrade", () => {
    expect(helperCacheKey("print(1)")).not.toBe(helperCacheKey("print(2)"))
    expect(helperBinaryPath("/cache", "print(1)")).not.toBe(
      helperBinaryPath("/cache", "print(2)"),
    )
  })

  it("places the binary inside a source-keyed app bundle", () => {
    expect(helperBinaryPath("/cache", "print(1)")).toBe(
      join(
        "/cache",
        helperCacheKey("print(1)"),
        "NowPlayingBridge.app",
        "Contents",
        "MacOS",
        "nowplaying-bridge",
      ),
    )
  })
})

describe("ensureHelper", () => {
  let cacheDir: string
  const fakeCompile = vi.fn(async (outputPath: string) => {
    await writeFile(outputPath, "binary")
  })
  const build = (source: string) =>
    ensureHelper({
      cacheDir,
      source,
      infoPlist: "<plist/>",
      compile: fakeCompile,
    })

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), "nowplaying-cache-"))
    fakeCompile.mockClear()
  })
  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true })
  })

  it("compiles once, writes the plist, and leaves no staging directory", async () => {
    const binary = await build("v1")
    expect(binary).toBe(helperBinaryPath(cacheDir, "v1"))
    expect(await readFile(binary, "utf8")).toBe("binary")
    expect(await readFile(join(binary, "..", "..", "Info.plist"), "utf8")).toBe(
      "<plist/>",
    )
    expect(await readdir(cacheDir)).toEqual([helperCacheKey("v1")])
    expect(fakeCompile).toHaveBeenCalledTimes(1)
  })

  it("reuses the cached helper while the source is unchanged", async () => {
    await build("v1")
    await build("v1")
    expect(fakeCompile).toHaveBeenCalledTimes(1)
  })

  it("rebuilds when the source changes", async () => {
    const first = await build("v1")
    const second = await build("v2")
    expect(second).not.toBe(first)
    expect(fakeCompile).toHaveBeenCalledTimes(2)
  })

  it("cleans up and rethrows when compilation fails", async () => {
    const failing = ensureHelper({
      cacheDir,
      source: "broken",
      infoPlist: "<plist/>",
      compile: async () => {
        throw new Error("swiftc failed")
      },
    })
    await expect(failing).rejects.toThrow("swiftc failed")
    expect(await readdir(cacheDir)).toEqual([])
  })

  it("accepts a bundle another process finished first", async () => {
    const racing = ensureHelper({
      cacheDir,
      source: "v1",
      infoPlist: "<plist/>",
      compile: async (outputPath) => {
        await writeFile(outputPath, "mine")
        // Simulate a concurrent caller completing the same bundle meanwhile.
        await ensureHelper({
          cacheDir,
          source: "v1",
          infoPlist: "<plist/>",
          compile: async (other) => writeFile(other, "theirs"),
        }).catch(() => undefined)
      },
    })
    const binary = await racing
    expect(await readFile(binary, "utf8")).toBe("theirs")
    expect(await readdir(cacheDir)).toEqual([helperCacheKey("v1")])
  })
})
