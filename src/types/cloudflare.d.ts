// The Worker bindings this app uses, declared locally.
//
// `@cloudflare/workers-types` declares a whole runtime — `Request`, `Response`,
// `fetch` — and adding it to tsconfig's `types` makes those collide with the
// DOM lib the React app compiles against (`HTMLDivElement` stops matching
// `Element`). Only four bindings matter here, so they are named directly and
// the global types stay as the app already had them.

declare module "cloudflare:workers" {
  /** The Worker's bindings, as fields. */
  export const env: Record<string, unknown>
}

interface D1Result<T = unknown> {
  results: T[]
  success: boolean
  meta: Record<string, unknown>
}

/** A D1 statement's prepared handle, as drizzle drives it. */
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = unknown>(colName?: string): Promise<T | null>
  run<T = unknown>(): Promise<D1Result<T>>
  all<T = unknown>(): Promise<D1Result<T>>
  raw<T = unknown>(): Promise<T[]>
}

interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>
  exec(query: string): Promise<{ count: number; duration: number }>
  dump(): Promise<ArrayBuffer>
}

interface R2HTTPMetadata {
  contentType?: string
  contentLanguage?: string
  contentDisposition?: string
  contentEncoding?: string
  cacheControl?: string
  cacheExpiry?: Date
}

interface R2Object {
  readonly key: string
  readonly size: number
  readonly etag: string
  readonly httpEtag: string
  readonly httpMetadata?: R2HTTPMetadata
  readonly uploaded: Date
}

interface R2ObjectBody extends R2Object {
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
  json<T = unknown>(): Promise<T>
  blob(): Promise<Blob>
}

interface R2Objects {
  objects: R2Object[]
  truncated: boolean
  cursor?: string
}

interface R2PutOptions {
  httpMetadata?: R2HTTPMetadata
  customMetadata?: Record<string, string>
  onlyIf?: { etagDoesNotMatch?: string }
}

interface R2Bucket {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | Blob | null,
    options?: R2PutOptions,
  ): Promise<R2Object | null>
  get(key: string): Promise<R2ObjectBody | null>
  head(key: string): Promise<R2Object | null>
  delete(keys: string | string[]): Promise<void>
  list(options?: {
    prefix?: string
    limit?: number
    cursor?: string
  }): Promise<R2Objects>
}

/** Workers KV, for the caches that can be stale (never for scene data). */
interface KVNamespace {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
}
