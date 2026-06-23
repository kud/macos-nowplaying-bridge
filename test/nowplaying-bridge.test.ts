import { describe, expect, it } from "vitest"
import { createNowPlayingBridge } from "../src/index.js"

describe("createNowPlayingBridge", () => {
  it("rejects on non-macOS platforms", async () => {
    const original = process.platform
    Object.defineProperty(process, "platform", { value: "linux" })
    try {
      await expect(createNowPlayingBridge()).rejects.toThrow(
        /only works on macOS/,
      )
    } finally {
      Object.defineProperty(process, "platform", { value: original })
    }
  })
})
