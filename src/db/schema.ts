import type { LibraryItem } from "@excalidraw/excalidraw/types"
import { sql } from "drizzle-orm"
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

// D1 is SQLite: no native boolean, no jsonb, no bytea, no identity columns.
// Timestamps are epoch milliseconds, so a Date round-trips as one and keeps
// ordering and range comparisons working in SQL.

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" })
const boolean = (name: string) => integer(name, { mode: "boolean" })

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").default(false),
  // "" when unset. better-auth's cookie cache rejects a null name.
  name: text("name").notNull(),
  image: text("image"),
  role: text("role", { enum: ["admin", "user"] })
    .notNull()
    .default("user"),
  createdAt: timestamp("createdAt")
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestamp("updatedAt")
    .notNull()
    .$defaultFn(() => new Date()),
})

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expiresAt").notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  createdAt: timestamp("createdAt")
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestamp("updatedAt")
    .notNull()
    .$defaultFn(() => new Date()),
})

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
  scope: text("scope"),
  password: text("password"),
  idToken: text("idToken"),
  createdAt: timestamp("createdAt")
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestamp("updatedAt")
    .notNull()
    .$defaultFn(() => new Date()),
})

export const verifications = sqliteTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt")
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestamp("updatedAt")
    .notNull()
    .$defaultFn(() => new Date()),
})

export const invites = sqliteTable("invites", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  invitedBy: text("invitedBy")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  usedBy: text("usedBy").references(() => users.id, { onDelete: "set null" }),
  usedAt: timestamp("usedAt"),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt")
    .notNull()
    .$defaultFn(() => new Date()),
})

// Personal access tokens: what a member's AI client signs in to the MCP
// endpoint with. Only a hash is kept; the token itself is shown once.
export const accessTokens = sqliteTable("access_tokens", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("tokenHash").notNull().unique(),
  // The token's first characters, so a member can tell tokens apart.
  start: text("start").notNull(),
  lastUsedAt: timestamp("lastUsedAt"),
  createdAt: timestamp("createdAt")
    .notNull()
    .$defaultFn(() => new Date()),
})

// OAuth clients an MCP client such as Claude.ai registered for itself
// (Dynamic Client Registration). All public: PKCE stands in for a secret.
export const oauthClients = sqliteTable("oauth_clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: text("redirectUris", { mode: "json" })
    .$type<string[]>()
    .notNull(),
  createdAt: timestamp("createdAt")
    .notNull()
    .$defaultFn(() => new Date()),
})

// One member's consent to one OAuth client. It holds a one-time code until
// the client trades it for tokens, then the current access and refresh token.
// Only hashes are kept. Deleting the row (or the member) ends the grant.
export const oauthGrants = sqliteTable("oauth_grants", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  clientId: text("clientId")
    .notNull()
    .references(() => oauthClients.id, { onDelete: "cascade" }),
  redirectUri: text("redirectUri").notNull(),
  codeHash: text("codeHash").unique(),
  codeChallenge: text("codeChallenge").notNull(),
  codeExpiresAt: timestamp("codeExpiresAt").notNull(),
  accessTokenHash: text("accessTokenHash").unique(),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
  refreshTokenHash: text("refreshTokenHash").unique(),
  lastUsedAt: timestamp("lastUsedAt"),
  createdAt: timestamp("createdAt")
    .notNull()
    .$defaultFn(() => new Date()),
})

// Admin-generated password-reset links (issue #68) — the product's only
// reset flow, shared out-of-band. Same single-use token model as invites,
// but targeted at a user and short-lived (24 h).
export const passwordResets = sqliteTable(
  "password_resets",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdBy: text("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    usedAt: timestamp("usedAt"),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    // At most one unused reset per user, enforced by the database — the
    // upsert in createPasswordReset targets this index so concurrent
    // generations serialize instead of leaving two live links.
    uniqueIndex("password_resets_one_pending_per_user")
      .on(table.userId)
      .where(sql`${table.usedAt} is null`),
  ],
)

// Where a drawing or folder lives: its creator's Private space or the shared
// Team space. Who may see a row is decided in features/spaces/access.ts.
export const spaces = ["private", "team"] as const
export type Space = (typeof spaces)[number]

export const folders = sqliteTable(
  "folders",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    space: text("space", { enum: spaces }).notNull().default("private"),
    // Null once the creator is deleted; only Team rows outlive them.
    createdBy: text("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    parentId: text("parentId"),
    // The Excalidraw+ collection this folder was imported from, so a second
    // import reuses it.
    excalidrawPlusId: text("excalidrawPlusId"),
    // Soft delete: set means "in trash". trashRootId records the trash unit —
    // the id of the folder/drawing whose trashing swept this row along — so a
    // whole subtree can be restored as one unit while each row's trashed
    // state stays individually knowable.
    deletedAt: timestamp("deletedAt"),
    trashRootId: text("trashRootId"),
    deletedBy: text("deletedBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt")
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp("updatedAt")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
    }).onDelete("cascade"),
    check(
      "folders_creator_unless_team",
      sql`${table.space} = 'team' OR ${table.createdBy} IS NOT NULL`,
    ),
  ],
)

export const drawings = sqliteTable(
  "drawings",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    data: text("data").notNull().default("{}"),
    // The scene's text, derived on every write so lists can search without
    // shipping scenes.
    searchText: text("searchText").notNull().default(""),
    folderId: text("folderId").references(() => folders.id, {
      onDelete: "cascade",
    }),
    // The Excalidraw+ scene this drawing was imported from, so a second
    // import skips it.
    excalidrawPlusId: text("excalidrawPlusId"),
    space: text("space", { enum: spaces }).notNull().default("private"),
    // See folders.createdBy.
    createdBy: text("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    // Soft delete — see folders.deletedAt/trashRootId for the model.
    deletedAt: timestamp("deletedAt"),
    trashRootId: text("trashRootId"),
    deletedBy: text("deletedBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt")
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp("updatedAt")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    check(
      "drawings_creator_unless_team",
      sql`${table.space} = 'team' OR ${table.createdBy} IS NOT NULL`,
    ),
  ],
)

// Per-member stars; a row means "starred by this member".
export const stars = sqliteTable(
  "stars",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    drawingId: text("drawingId")
      .notNull()
      .references(() => drawings.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.drawingId] })],
)

// A drawing is shared iff it has a row here; at most one link per drawing.
export const shares = sqliteTable(
  "shares",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    drawingId: text("drawingId")
      .notNull()
      .references(() => drawings.id, { onDelete: "cascade" }),
    audience: text("audience", { enum: ["members", "anyone"] })
      .notNull()
      .default("members"),
    createdAt: timestamp("createdAt")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("shares_one_link_per_drawing").on(table.drawingId),
  ],
)

// A members link dropped by a move to Team. Not a share: it only sends
// signed-in members on to the drawing.
export const shareRedirects = sqliteTable("share_redirects", {
  token: text("token").primaryKey(),
  drawingId: text("drawingId")
    .notNull()
    .references(() => drawings.id, { onDelete: "cascade" }),
})

// A drawing's image, kept in R2 (features/drawings/image-store.ts). The row is
// the index: it holds the size and ETag so a listing or a quota check never
// touches the object, and so a delete can find what to remove.
export const drawingFiles = sqliteTable(
  "drawing_files",
  {
    id: text("id").primaryKey(),
    drawingId: text("drawingId")
      .notNull()
      .references(() => drawings.id, { onDelete: "cascade" }),
    fileId: text("fileId").notNull(),
    mimeType: text("mimeType").notNull(),
    size: integer("size").notNull().default(0),
    // R2's ETag: the object's identity, so a rewrite can be told from a no-op.
    etag: text("etag"),
    createdAt: timestamp("createdAt")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("drawing_files_one_row_per_file").on(
      table.drawingId,
      table.fileId,
    ),
  ],
)

// The team library: the Library panel's items, one set for the instance.
// `item` is Excalidraw's LibraryItem as is; newest (highest seq) first.
// SQLite has no identity column, so seq is assigned by the writer.
export const libraryItems = sqliteTable("library_items", {
  id: text("id").primaryKey(),
  item: text("item", { mode: "json" }).$type<LibraryItem>().notNull(),
  seq: integer("seq").notNull(),
})

// A comment thread pinned to one spot on a drawing. Never part of the scene.
// The pin sits at (x, y), or, with elementId set, at (offsetX, offsetY) as a
// fraction of that element's box; (x, y) is then where it was made.
export const commentThreads = sqliteTable(
  "comment_threads",
  {
    id: text("id").primaryKey(),
    drawingId: text("drawingId")
      .notNull()
      .references(() => drawings.id, { onDelete: "cascade" }),
    createdBy: text("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    x: real("x").notNull(),
    y: real("y").notNull(),
    elementId: text("elementId"),
    offsetX: real("offsetX"),
    offsetY: real("offsetY"),
    resolvedAt: timestamp("resolvedAt"),
    resolvedBy: text("resolvedBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt")
      .notNull()
      .$defaultFn(() => new Date()),
    lastActivityAt: timestamp("lastActivityAt")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("comment_threads_drawing").on(table.drawingId),
    check(
      "comment_threads_element_anchor",
      sql`(${table.elementId} is null) = (${table.offsetX} is null) and (${table.elementId} is null) = (${table.offsetY} is null)`,
    ),
  ],
)

// One message in a thread. A thread's first comment opens it.
export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    threadId: text("threadId")
      .notNull()
      .references(() => commentThreads.id, { onDelete: "cascade" }),
    authorId: text("authorId").references(() => users.id, {
      onDelete: "set null",
    }),
    // The AI client's name when written over MCP.
    via: text("via"),
    body: text("body").notNull(),
    createdAt: timestamp("createdAt")
      .notNull()
      .$defaultFn(() => new Date()),
    editedAt: timestamp("editedAt"),
  },
  (table) => [index("comments_thread").on(table.threadId, table.createdAt)],
)

// When a member last opened a thread, for its unread dot.
export const commentReads = sqliteTable(
  "comment_reads",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    threadId: text("threadId")
      .notNull()
      .references(() => commentThreads.id, { onDelete: "cascade" }),
    readAt: timestamp("readAt").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.threadId] })],
)
