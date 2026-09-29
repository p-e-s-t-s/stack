CREATE TABLE `subtitles_assignments` (
	`media_id` integer PRIMARY KEY,
	`profile_id` integer,
	CONSTRAINT `fk_subtitles_assignments_media_id_library_media_items_id_fk` FOREIGN KEY (`media_id`) REFERENCES `library_media_items`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_subtitles_assignments_profile_id_subtitles_profiles_id_fk` FOREIGN KEY (`profile_id`) REFERENCES `subtitles_profiles`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `subtitles_blocklist` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`file_id` integer NOT NULL,
	`generation` text NOT NULL,
	`candidate_id` text NOT NULL,
	CONSTRAINT `fk_subtitles_blocklist_file_id_library_media_files_id_fk` FOREIGN KEY (`file_id`) REFERENCES `library_media_files`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `subtitles_defaults` (
	`kind` text PRIMARY KEY,
	`profile_id` integer,
	CONSTRAINT `fk_subtitles_defaults_profile_id_subtitles_profiles_id_fk` FOREIGN KEY (`profile_id`) REFERENCES `subtitles_profiles`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `subtitles_inventory` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`file_id` integer NOT NULL,
	`generation` text NOT NULL,
	`location` text NOT NULL,
	`embedded` integer NOT NULL,
	`format` text NOT NULL,
	`language` text,
	`forced` integer,
	`hi` integer,
	`hash` text,
	`managed` integer DEFAULT false NOT NULL,
	`protected` integer DEFAULT false NOT NULL,
	`present` integer DEFAULT true NOT NULL,
	`valid` integer DEFAULT true NOT NULL,
	`error` text,
	`provider_id` text,
	`candidate_id` text,
	`score` integer,
	`evidence` text,
	`acquired_at` integer,
	`sync` text DEFAULT 'off' NOT NULL,
	`sync_error` text,
	CONSTRAINT `fk_subtitles_inventory_file_id_library_media_files_id_fk` FOREIGN KEY (`file_id`) REFERENCES `library_media_files`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `subtitles_operations` (
	`id` text PRIMARY KEY,
	`file_id` integer NOT NULL,
	`root` text NOT NULL,
	`target` text NOT NULL,
	`staged` text NOT NULL,
	`backup` text NOT NULL,
	`old_hash` text,
	`new_hash` text NOT NULL,
	`record` text NOT NULL,
	`state` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subtitles_probes` (
	`file_id` integer PRIMARY KEY,
	`generation` text NOT NULL,
	`facts` text,
	`error` text,
	`scanned_at` integer NOT NULL,
	CONSTRAINT `fk_subtitles_probes_file_id_library_media_files_id_fk` FOREIGN KEY (`file_id`) REFERENCES `library_media_files`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `subtitles_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL UNIQUE,
	`revision` integer DEFAULT 1 NOT NULL,
	`requirements` text NOT NULL,
	`policy` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subtitles_provider_state` (
	`id` text PRIMARY KEY,
	`error` text,
	`code` text,
	`retry_at` integer,
	`remaining` integer,
	`reset_at` integer
);
--> statement-breakpoint
CREATE TABLE `subtitles_settings` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subtitles_wanted` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`file_id` integer NOT NULL,
	`requirement_id` text NOT NULL,
	`profile_id` integer NOT NULL,
	`revision` integer NOT NULL,
	`generation` text NOT NULL,
	`state` text NOT NULL,
	`reason` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_search_at` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_subtitles_wanted_file_id_library_media_files_id_fk` FOREIGN KEY (`file_id`) REFERENCES `library_media_files`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_subtitles_wanted_profile_id_subtitles_profiles_id_fk` FOREIGN KEY (`profile_id`) REFERENCES `subtitles_profiles`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subtitles_blocklist_candidate_idx` ON `subtitles_blocklist` (`file_id`,`generation`,`candidate_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `subtitles_inventory_location_idx` ON `subtitles_inventory` (`file_id`,`location`);--> statement-breakpoint
CREATE INDEX `subtitles_inventory_file_idx` ON `subtitles_inventory` (`file_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `subtitles_wanted_requirement_idx` ON `subtitles_wanted` (`file_id`,`requirement_id`);--> statement-breakpoint
CREATE INDEX `subtitles_wanted_due_idx` ON `subtitles_wanted` (`next_search_at`);