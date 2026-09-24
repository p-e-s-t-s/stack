CREATE TABLE `library_alternate_titles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_id` integer NOT NULL,
	`title` text NOT NULL,
	`normalized` text NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `library_media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `library_alternate_titles_normalized_idx` ON `library_alternate_titles` (`normalized`);--> statement-breakpoint
CREATE TABLE `library_media_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_id` integer NOT NULL,
	`path` text NOT NULL,
	`size` integer NOT NULL,
	`quality` text NOT NULL,
	`format_score` integer DEFAULT 0 NOT NULL,
	`languages` text NOT NULL,
	`release_name` text,
	`release_group` text,
	`revision` text NOT NULL,
	`added_at` integer NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `library_media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `library_media_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`sort_title` text NOT NULL,
	`year` integer,
	`overview` text,
	`poster_url` text,
	`monitored` integer DEFAULT true NOT NULL,
	`external_ids` text NOT NULL,
	`primary_provider` text NOT NULL,
	`profile_id` integer NOT NULL,
	`root_folder_id` integer NOT NULL,
	`folder` text NOT NULL,
	`added_at` integer NOT NULL,
	`refreshed_at` integer,
	FOREIGN KEY (`profile_id`) REFERENCES `decision_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`root_folder_id`) REFERENCES `library_root_folders`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `library_media_items_kind_idx` ON `library_media_items` (`kind`);--> statement-breakpoint
CREATE TABLE `library_root_folders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`path` text NOT NULL,
	`kind` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_root_folders_path_unique` ON `library_root_folders` (`path`);--> statement-breakpoint
CREATE TABLE `library_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
