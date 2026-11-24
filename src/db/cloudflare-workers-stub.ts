// Stands in for `cloudflare:workers` in tests.
//
// The real module is provided by the Workers runtime, so it cannot be imported
// by Node. Modules reach it for one thing — the `env` bindings (D1, R2, KV) —
// and a test that needs a binding passes a fake through this object instead of
// mocking each module that touches it.
//
// Bound in `vitest.config.ts` as an alias; never imported by app code.

type Bindings = Record<string, unknown>

export const env: Bindings = {}

/** Sets a binding for the current test, and returns a reset for it. */
export function bind<K extends string>(name: K, value: unknown): () => void {
  const had = name in env
  const previous = env[name]
  env[name] = value
  return () => {
    if (had) env[name] = previous
    else delete env[name]
  }
}

/** An in-memory R2 bucket, enough for the image store's put/get/delete. */
export function fakeImages() {
  const objects = new Map<string, { bytes: Uint8Array; httpEtag: string }>()
  let counter = 0
  return {
    objects,
    async put(key: string, value: Uint8Array) {
      if (objects.has(key)) return null
      const httpEtag = `"${++counter}"`
      objects.set(key, { bytes: value, httpEtag })
      return { httpEtag }
    },
    async get(key: string) {
      const object = objects.get(key)
      if (!object) return null
      return {
        ...object,
        // Slice by the view's own bounds: a `Buffer` can be a window onto a
        // much larger shared pool, so `bytes.buffer` alone is the wrong bytes.
        arrayBuffer: async () =>
          object.bytes.buffer.slice(
            object.bytes.byteOffset,
            object.bytes.byteOffset + object.bytes.byteLength,
          ),
      }
    },
    async delete(key: string) {
      objects.delete(key)
    },
  }
}
