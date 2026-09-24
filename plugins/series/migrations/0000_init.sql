CREATE TABLE `series_details` (
	`media_id` integer PRIMARY KEY NOT NULL,
	`tmdb_id` integer NOT NULL,
	`tvdb_id` integer,
	`imdb_id` text,
	`series_type` text DEFAULT 'standard' NOT NULL,
	`status` text,
	`network` text,
	`runtime_minutes` integer,
	`original_language` text,
	`backdrop_url` text,
	`genres` text,
	`first_aired` text,
	`season_folders` integer DEFAULT true NOT NULL,
	`monitor_new` integer DEFAULT true NOT NULL,
	`last_searched_at` integer,
	FOREIGN KEY (`media_id`) REFERENCES `library_media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `series_details_tmdb_id_unique` ON `series_details` (`tmdb_id`);--> statement-breakpoint
CREATE TABLE `series_episode_files` (
	`file_id` integer NOT NULL,
	`episode_id` integer NOT NULL,
	PRIMARY KEY(`file_id`, `episode_id`),
	FOREIGN KEY (`file_id`) REFERENCES `library_media_files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`episode_id`) REFERENCES `series_episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `series_episode_files_episode_idx` ON `series_episode_files` (`episode_id`);--> statement-breakpoint
CREATE TABLE `series_episodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_id` integer NOT NULL,
	`season` integer NOT NULL,
	`number` integer NOT NULL,
	`absolute_number` integer,
	`title` text,
	`overview` text,
	`air_date` text,
	`runtime_minutes` integer,
	`monitored` integer DEFAULT true NOT NULL,
	`last_searched_at` integer,
	FOREIGN KEY (`media_id`) REFERENCES `library_media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `series_episodes_number_idx` ON `series_episodes` (`media_id`,`season`,`number`);--> statement-breakpoint
CREATE INDEX `series_episodes_air_date_idx` ON `series_episodes` (`air_date`);--> statement-breakpoint
CREATE TABLE `series_seasons` (
	`media_id` integer NOT NULL,
	`number` integer NOT NULL,
	`title` text,
	`poster_url` text,
	`monitored` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`media_id`, `number`),
	FOREIGN KEY (`media_id`) REFERENCES `library_media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
