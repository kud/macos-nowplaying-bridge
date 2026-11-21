import { createHash, randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

const bundleName = "NowPlayingBridge.app"
const executableName = "nowplaying-bridge"

/**
 * Cache key for the compiled helper: a short hash of the Swift source. Any
 * change to the shipped source (e.g. a package upgrade) yields a new key, so
 * the helper is rebuilt once instead of a stale binary being reused.
 */
export const helperCacheKey = (source: string | Buffer): string =>
  createHash("sha256").update(source).digest("hex").slice(0, 16)

const binaryIn = (bundleDir: string): string =>
  join(bundleDir, "Contents", "MacOS", executableName)

/** Where the helper for this exact source lives inside the cache directory. */
export const helperBinaryPath = (
  cacheDir: string,
  source: string | Buffer,
): string => binaryIn(join(cacheDir, helperCacheKey(source), bundleName))

export type CompileHelper = (outputPath: string) => Promise<void>

/**
 * Return the cached helper for `source`, building it first if absent. The
 * whole bundle is assembled in a private staging directory and renamed into
 * place in one step, so concurrent callers never launch a half-written bundle.
 */
export const ensureHelper = async ({
  cacheDir,
  source,
  infoPlist,
  compile,
}: {
  cacheDir: string
  source: string | Buffer
  infoPlist: string
  compile: CompileHelper
}): Promise<string> => {
  const binaryPath = helperBinaryPath(cacheDir, source)
  if (existsSync(binaryPath)) return binaryPath

  const key = helperCacheKey(source)
  const stagingDir = join(cacheDir, `${key}.${process.pid}.${randomUUID()}.tmp`)
  const stagingBundle = join(stagingDir, bundleName)
  try {
    await mkdir(dirname(binaryIn(stagingBundle)), { recursive: true })
    await compile(binaryIn(stagingBundle))
    await writeFile(join(stagingBundle, "Contents", "Info.plist"), infoPlist)
    try {
      await rename(stagingDir, join(cacheDir, key))
    } catch (error) {
      // Another process won the race; its bundle is complete, so use it.
      if (!existsSync(binaryPath)) throw error
    }
  } finally {
    await rm(stagingDir, { recursive: true, force: true })
  }
  return binaryPath
}
