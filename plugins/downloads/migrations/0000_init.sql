CREATE TABLE `downloads_blocklist` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_id` integer NOT NULL,
	`title` text NOT NULL,
	`info_hash` text,
	`indexer_id` text,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `library_media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `downloads_blocklist_media_idx` ON `downloads_blocklist` (`media_id`);--> statement-breakpoint
CREATE TABLE `downloads_grabs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_id` integer NOT NULL,
	`release` text NOT NULL,
	`title` text NOT NULL,
	`quality` text NOT NULL,
	`format_score` integer DEFAULT 0 NOT NULL,
	`protocol` text NOT NULL,
	`client_id` text NOT NULL,
	`download_id` text NOT NULL,
	`state` text NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`size_bytes` integer,
	`eta_seconds` integer,
	`output_path` text,
	`error` text,
	`manual` integer DEFAULT false NOT NULL,
	`grabbed_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_progress_at` integer NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `library_media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `downloads_grabs_state_idx` ON `downloads_grabs` (`state`);--> statement-breakpoint
CREATE INDEX `downloads_grabs_media_idx` ON `downloads_grabs` (`media_id`);