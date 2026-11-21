import { describe, expect, it } from "vitest"
import { initialRateMemory, resolveRate, type RateMemory } from "../src/rate.js"

const run = (updates: Parameters<typeof resolveRate>[1][]): number[] => {
  let memory: RateMemory = initialRateMemory
  return updates.map((info) => {
    memory = resolveRate(memory, info)
    return memory.rate
  })
}

describe("resolveRate", () => {
  it("starts at normal speed", () => {
    expect(run([{}])).toEqual([1])
  })

  it("keeps the last known rate when an update carries none", () => {
    expect(run([{ rate: 1.5 }, {}, {}])).toEqual([1.5, 1.5, 1.5])
    expect(run([{ rate: 0 }, {}])).toEqual([0, 0])
  })

  it("does not reset an explicit rate to 1 on a metadata-only update", () => {
    expect(run([{ rate: 2, state: "playing" }, {}])).toEqual([2, 2])
  })

  it("derives 0 from a pause and restores the playing rate on resume", () => {
    expect(
      run([
        { rate: 1.25, state: "playing" },
        { state: "paused" },
        {},
        { state: "playing" },
      ]),
    ).toEqual([1.25, 0, 0, 1.25])
  })

  it("lets an explicit rate win over the state", () => {
    expect(run([{ state: "paused", rate: 0.5 }])).toEqual([0.5])
    expect(run([{ rate: 0 }, { state: "playing" }])).toEqual([0, 1])
  })
})
