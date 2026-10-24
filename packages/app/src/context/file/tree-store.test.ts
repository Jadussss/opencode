import { describe, expect, test } from "bun:test"
import type { FileNode } from "@opencode-ai/sdk/v2"
import { createFileTreeStore } from "./tree-store"

function deferred() {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function node(path: string): FileNode {
  return { path, type: "file", name: path.split("/").pop() ?? path, absolute: `/repo/${path}`, ignored: false }
}

function setup() {
  const calls: string[] = []
  const gates: { promise: Promise<void>; resolve: () => void }[] = []
  const store = createFileTreeStore({
    scope: () => "/repo",
    normalizeDir: (input) => input.replace(/\/+$/, ""),
    list: (dir) => {
      calls.push(dir)
      const gate = deferred()
      gates.push(gate)
      return gate.promise.then(() => [node(`${dir}/file.ts`)])
    },
    onError: (message) => {
      throw new Error(`unexpected list error: ${message}`)
    },
  })
  return { store, calls, gates }
}

describe("file tree store refresh", () => {
  test("a forced refresh is not swallowed by an in-flight load", async () => {
    const { store, calls, gates } = setup()

    const initial = store.listDir("src")
    const forced = store.listDir("src", { force: true })

    expect(calls).toEqual(["src"])

    gates[0].resolve()
    await initial

    // The forced refresh re-lists only after the pending load finished, so the
    // directory cannot stay stale until an app restart.
    expect(calls).toEqual(["src", "src"])

    gates[1].resolve()
    await forced

    expect(store.isLoaded("src")).toBe(true)
    expect(store.children("src").map((item) => item.path)).toEqual(["src/file.ts"])
  })

  test("a non-forced refresh joins the in-flight load", async () => {
    const { store, calls, gates } = setup()

    const initial = store.listDir("src")
    const joined = store.listDir("src")

    expect(joined).toBe(initial)
    expect(calls).toEqual(["src"])

    gates[0].resolve()
    await joined
    expect(calls).toEqual(["src"])
  })

  test("a forced refresh after loading re-lists once, then serves the cache", async () => {
    const { store, calls, gates } = setup()

    const initial = store.listDir("src")
    gates[0].resolve()
    await initial

    const cached = store.listDir("src")
    await cached
    expect(calls).toEqual(["src"])

    const forced = store.listDir("src", { force: true })
    gates[1].resolve()
    await forced
    expect(calls).toEqual(["src", "src"])
  })
})
