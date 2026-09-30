CREATE TABLE `library_targets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_id` integer NOT NULL,
	`name` text NOT NULL,
	`profile_id` integer NOT NULL,
	`monitored` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `library_media_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `decision_profiles`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_targets_media_name_idx` ON `library_targets` (`media_id`,`name`);--> statement-breakpoint
ALTER TABLE `library_media_files` ADD `target_id` integer REFERENCES library_targets(id) ON DELETE restrict;
