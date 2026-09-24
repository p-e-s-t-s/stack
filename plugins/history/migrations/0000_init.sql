CREATE TABLE `history_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_id` integer NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `library_media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `history_events_media_idx` ON `history_events` (`media_id`);--> statement-breakpoint
CREATE INDEX `history_events_created_idx` ON `history_events` (`created_at`);