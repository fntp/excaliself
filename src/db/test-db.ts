// A database for tests: in-memory SQLite, the same dialect D1 runs.
//
// The suite used to build a PGlite (Postgres) from ./drizzle. That can't work
// now: the schema is sqlite-core, and a Postgres engine rejects it outright.
// Node 24 ships `node:sqlite`, so the tests need no native module — the
// statements, the dialect, and the constraints are the ones production gets.

import { DatabaseSync } from "node:sqlite"
import { drizzle } from "drizzle-orm/sqlite-proxy"
import type { Db } from "./index.ts"
import * as schema from "./schema.ts"

/** The DDL the schema.ts tables describe, hand-written to match it. */
const DDL = `
CREATE TABLE users (
  id text PRIMARY KEY NOT NULL,
  email text NOT NULL UNIQUE,
  emailVerified integer DEFAULT false,
  name text NOT NULL,
  image text,
  role text DEFAULT 'user' NOT NULL,
  createdAt integer NOT NULL,
  updatedAt integer NOT NULL
);

CREATE TABLE sessions (
  id text PRIMARY KEY NOT NULL,
  userId text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expiresAt integer NOT NULL,
  token text NOT NULL UNIQUE,
  ipAddress text,
  userAgent text,
  createdAt integer NOT NULL,
  updatedAt integer NOT NULL
);

CREATE TABLE accounts (
  id text PRIMARY KEY NOT NULL,
  userId text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accountId text NOT NULL,
  providerId text NOT NULL,
  accessToken text,
  refreshToken text,
  accessTokenExpiresAt integer,
  refreshTokenExpiresAt integer,
  scope text,
  password text,
  idToken text,
  createdAt integer NOT NULL,
  updatedAt integer NOT NULL
);

CREATE TABLE verifications (
  id text PRIMARY KEY NOT NULL,
  identifier text NOT NULL,
  value text NOT NULL,
  expiresAt integer NOT NULL,
  createdAt integer NOT NULL,
  updatedAt integer NOT NULL
);

CREATE TABLE invites (
  id text PRIMARY KEY NOT NULL,
  token text NOT NULL UNIQUE,
  invitedBy text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usedBy text REFERENCES users(id) ON DELETE SET NULL,
  usedAt integer,
  expiresAt integer NOT NULL,
  createdAt integer NOT NULL
);

CREATE TABLE access_tokens (
  id text PRIMARY KEY NOT NULL,
  userId text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  tokenHash text NOT NULL UNIQUE,
  start text NOT NULL,
  lastUsedAt integer,
  createdAt integer NOT NULL
);

CREATE TABLE oauth_clients (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  redirectUris text NOT NULL,
  createdAt integer NOT NULL
);

CREATE TABLE oauth_grants (
  id text PRIMARY KEY NOT NULL,
  userId text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clientId text NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  redirectUri text NOT NULL,
  codeHash text UNIQUE,
  codeChallenge text NOT NULL,
  codeExpiresAt integer NOT NULL,
  accessTokenHash text UNIQUE,
  accessTokenExpiresAt integer,
  refreshTokenHash text UNIQUE,
  lastUsedAt integer,
  createdAt integer NOT NULL
);

CREATE TABLE password_resets (
  id text PRIMARY KEY NOT NULL,
  token text NOT NULL UNIQUE,
  userId text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  createdBy text REFERENCES users(id) ON DELETE SET NULL,
  usedAt integer,
  expiresAt integer NOT NULL,
  createdAt integer NOT NULL
);
CREATE UNIQUE INDEX password_resets_one_pending_per_user
  ON password_resets (userId) WHERE usedAt IS NULL;

CREATE TABLE folders (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  space text DEFAULT 'private' NOT NULL,
  createdBy text REFERENCES users(id) ON DELETE SET NULL,
  parentId text REFERENCES folders(id) ON DELETE CASCADE,
  excalidrawPlusId text,
  deletedAt integer,
  trashRootId text,
  deletedBy text REFERENCES users(id) ON DELETE SET NULL,
  createdAt integer NOT NULL,
  updatedAt integer NOT NULL,
  CONSTRAINT folders_creator_unless_team
    CHECK (space = 'team' OR createdBy IS NOT NULL)
);

CREATE TABLE drawings (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  data text DEFAULT '{}' NOT NULL,
  searchText text DEFAULT '' NOT NULL,
  folderId text REFERENCES folders(id) ON DELETE CASCADE,
  excalidrawPlusId text,
  space text DEFAULT 'private' NOT NULL,
  createdBy text REFERENCES users(id) ON DELETE SET NULL,
  deletedAt integer,
  trashRootId text,
  deletedBy text REFERENCES users(id) ON DELETE SET NULL,
  createdAt integer NOT NULL,
  updatedAt integer NOT NULL,
  CONSTRAINT drawings_creator_unless_team
    CHECK (space = 'team' OR createdBy IS NOT NULL)
);

CREATE TABLE stars (
  userId text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  drawingId text NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  PRIMARY KEY (userId, drawingId)
);

CREATE TABLE shares (
  id text PRIMARY KEY NOT NULL,
  token text NOT NULL UNIQUE,
  drawingId text NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  audience text DEFAULT 'members' NOT NULL,
  createdAt integer NOT NULL
);
CREATE UNIQUE INDEX shares_one_link_per_drawing ON shares (drawingId);

CREATE TABLE share_redirects (
  token text PRIMARY KEY NOT NULL,
  drawingId text NOT NULL REFERENCES drawings(id) ON DELETE CASCADE
);

CREATE TABLE drawing_files (
  id text PRIMARY KEY NOT NULL,
  drawingId text NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  fileId text NOT NULL,
  mimeType text NOT NULL,
  size integer DEFAULT 0 NOT NULL,
  etag text,
  createdAt integer NOT NULL
);
CREATE UNIQUE INDEX drawing_files_one_row_per_file
  ON drawing_files (drawingId, fileId);

CREATE TABLE library_items (
  id text PRIMARY KEY NOT NULL,
  item text NOT NULL,
  seq integer NOT NULL
);

CREATE TABLE comment_threads (
  id text PRIMARY KEY NOT NULL,
  drawingId text NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  createdBy text REFERENCES users(id) ON DELETE SET NULL,
  x real NOT NULL,
  y real NOT NULL,
  elementId text,
  offsetX real,
  offsetY real,
  resolvedAt integer,
  resolvedBy text REFERENCES users(id) ON DELETE SET NULL,
  createdAt integer NOT NULL,
  lastActivityAt integer NOT NULL,
  CONSTRAINT comment_threads_element_anchor
    CHECK ((elementId IS NULL) = (offsetX IS NULL)
       AND (elementId IS NULL) = (offsetY IS NULL))
);
CREATE INDEX comment_threads_drawing ON comment_threads (drawingId);

CREATE TABLE comments (
  id text PRIMARY KEY NOT NULL,
  threadId text NOT NULL REFERENCES comment_threads(id) ON DELETE CASCADE,
  authorId text REFERENCES users(id) ON DELETE SET NULL,
  via text,
  body text NOT NULL,
  createdAt integer NOT NULL,
  editedAt integer
);
CREATE INDEX comments_thread ON comments (threadId, createdAt);

CREATE TABLE comment_reads (
  userId text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  threadId text NOT NULL REFERENCES comment_threads(id) ON DELETE CASCADE,
  readAt integer NOT NULL,
  PRIMARY KEY (userId, threadId)
);
`

/**
 * A fresh in-memory database holding the whole schema. Drizzle is driven
 * through sqlite-proxy, which hands every statement to `node:sqlite` and maps
 * rows back; the result is the same SQL a D1 worker would run.
 */
export function createTestDb(): Db {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec("PRAGMA foreign_keys = ON")
  sqlite.exec(DDL)

  return drizzle(
    async (query, params, method) => {
      const statement = sqlite.prepare(query)
      if (method === "run") {
        statement.run(...params)
        return { rows: [] }
      }
      const rows = statement.all(...params) as Record<string, unknown>[]
      if (method === "get") return { rows: rows[0] ? Object.values(rows[0]) : [] }
      return { rows: rows.map((row) => Object.values(row)) }
    },
    { schema },
  ) as unknown as Db
}
