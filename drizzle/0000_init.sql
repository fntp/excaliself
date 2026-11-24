CREATE TABLE `access_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`name` text NOT NULL,
	`tokenHash` text NOT NULL,
	`start` text NOT NULL,
	`lastUsedAt` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_tokens_tokenHash_unique` ON `access_tokens` (`tokenHash`);--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`accessTokenExpiresAt` integer,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`password` text,
	`idToken` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `comment_reads` (
	`userId` text NOT NULL,
	`threadId` text NOT NULL,
	`readAt` integer NOT NULL,
	PRIMARY KEY(`userId`, `threadId`),
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`threadId`) REFERENCES `comment_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `comment_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`drawingId` text NOT NULL,
	`createdBy` text,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`elementId` text,
	`offsetX` real,
	`offsetY` real,
	`resolvedAt` integer,
	`resolvedBy` text,
	`createdAt` integer NOT NULL,
	`lastActivityAt` integer NOT NULL,
	FOREIGN KEY (`drawingId`) REFERENCES `drawings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`resolvedBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "comment_threads_element_anchor" CHECK(("comment_threads"."elementId" is null) = ("comment_threads"."offsetX" is null) and ("comment_threads"."elementId" is null) = ("comment_threads"."offsetY" is null))
);
--> statement-breakpoint
CREATE INDEX `comment_threads_drawing` ON `comment_threads` (`drawingId`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`threadId` text NOT NULL,
	`authorId` text,
	`via` text,
	`body` text NOT NULL,
	`createdAt` integer NOT NULL,
	`editedAt` integer,
	FOREIGN KEY (`threadId`) REFERENCES `comment_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `comments_thread` ON `comments` (`threadId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `drawing_files` (
	`id` text PRIMARY KEY NOT NULL,
	`drawingId` text NOT NULL,
	`fileId` text NOT NULL,
	`mimeType` text NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`etag` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`drawingId`) REFERENCES `drawings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `drawing_files_one_row_per_file` ON `drawing_files` (`drawingId`,`fileId`);--> statement-breakpoint
CREATE TABLE `drawings` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`searchText` text DEFAULT '' NOT NULL,
	`folderId` text,
	`excalidrawPlusId` text,
	`space` text DEFAULT 'private' NOT NULL,
	`createdBy` text,
	`deletedAt` integer,
	`trashRootId` text,
	`deletedBy` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`folderId`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`deletedBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "drawings_creator_unless_team" CHECK("drawings"."space" = 'team' OR "drawings"."createdBy" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `folders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`space` text DEFAULT 'private' NOT NULL,
	`createdBy` text,
	`parentId` text,
	`excalidrawPlusId` text,
	`deletedAt` integer,
	`trashRootId` text,
	`deletedBy` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`deletedBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parentId`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "folders_creator_unless_team" CHECK("folders"."space" = 'team' OR "folders"."createdBy" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`invitedBy` text NOT NULL,
	`usedBy` text,
	`usedAt` integer,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`invitedBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`usedBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_unique` ON `invites` (`token`);--> statement-breakpoint
CREATE TABLE `library_items` (
	`id` text PRIMARY KEY NOT NULL,
	`item` text NOT NULL,
	`seq` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`redirectUris` text NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`clientId` text NOT NULL,
	`redirectUri` text NOT NULL,
	`codeHash` text,
	`codeChallenge` text NOT NULL,
	`codeExpiresAt` integer NOT NULL,
	`accessTokenHash` text,
	`accessTokenExpiresAt` integer,
	`refreshTokenHash` text,
	`lastUsedAt` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`clientId`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_grants_codeHash_unique` ON `oauth_grants` (`codeHash`);--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_grants_accessTokenHash_unique` ON `oauth_grants` (`accessTokenHash`);--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_grants_refreshTokenHash_unique` ON `oauth_grants` (`refreshTokenHash`);--> statement-breakpoint
CREATE TABLE `password_resets` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`userId` text NOT NULL,
	`createdBy` text,
	`usedAt` integer,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_resets_token_unique` ON `password_resets` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `password_resets_one_pending_per_user` ON `password_resets` (`userId`) WHERE "password_resets"."usedAt" is null;--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`token` text NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE TABLE `share_redirects` (
	`token` text PRIMARY KEY NOT NULL,
	`drawingId` text NOT NULL,
	FOREIGN KEY (`drawingId`) REFERENCES `drawings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `shares` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`drawingId` text NOT NULL,
	`audience` text DEFAULT 'members' NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`drawingId`) REFERENCES `drawings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shares_token_unique` ON `shares` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `shares_one_link_per_drawing` ON `shares` (`drawingId`);--> statement-breakpoint
CREATE TABLE `stars` (
	`userId` text NOT NULL,
	`drawingId` text NOT NULL,
	PRIMARY KEY(`userId`, `drawingId`),
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`drawingId`) REFERENCES `drawings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`emailVerified` integer DEFAULT false,
	`name` text NOT NULL,
	`image` text,
	`role` text DEFAULT 'user' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
