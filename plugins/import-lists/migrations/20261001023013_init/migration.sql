CREATE TABLE `importlists_exclusions` (
	`key` text PRIMARY KEY,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `importlists_seen` (
	`list_id` text NOT NULL,
	`key` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`year` integer,
	`status` text NOT NULL,
	`media_id` integer,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	CONSTRAINT `importlists_seen_pk` PRIMARY KEY(`list_id`, `key`),
	CONSTRAINT `fk_importlists_seen_media_id_library_media_items_id_fk` FOREIGN KEY (`media_id`) REFERENCES `library_media_items`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `importlists_status` (
	`list_id` text PRIMARY KEY,
	`last_synced_at` integer,
	`last_error` text,
	`added` integer DEFAULT 0 NOT NULL,
	`existing` integer DEFAULT 0 NOT NULL,
	`excluded` integer DEFAULT 0 NOT NULL,
	`unmatched` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL
);
