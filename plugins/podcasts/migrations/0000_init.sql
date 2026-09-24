CREATE TABLE `podcasts_details` (
	`media_id` integer PRIMARY KEY NOT NULL,
	`feed_url` text NOT NULL,
	`itunes_id` text,
	`author` text,
	`link` text,
	`language` text,
	`monitor_new` integer DEFAULT true NOT NULL,
	`keep_latest` integer,
	`etag` text,
	`last_modified` text,
	`refreshed_at` integer,
	`refresh_error` text,
	FOREIGN KEY (`media_id`) REFERENCES `library_media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `podcasts_details_feed_url_unique` ON `podcasts_details` (`feed_url`);--> statement-breakpoint
CREATE TABLE `podcasts_episode_files` (
	`file_id` integer PRIMARY KEY NOT NULL,
	`episode_id` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `library_media_files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`episode_id`) REFERENCES `podcasts_episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `podcasts_episode_files_episode_idx` ON `podcasts_episode_files` (`episode_id`);--> statement-breakpoint
CREATE TABLE `podcasts_episodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_id` integer NOT NULL,
	`guid` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`published_at` text,
	`enclosure_url` text NOT NULL,
	`enclosure_type` text,
	`enclosure_size` integer,
	`duration_seconds` integer,
	`season` integer,
	`number` integer,
	`monitored` integer DEFAULT true NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	FOREIGN KEY (`media_id`) REFERENCES `library_media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `podcasts_episodes_guid_idx` ON `podcasts_episodes` (`media_id`,`guid`);--> statement-breakpoint
CREATE INDEX `podcasts_episodes_published_idx` ON `podcasts_episodes` (`published_at`);--> statement-breakpoint
CREATE TABLE `podcasts_grab_episodes` (
	`grab_id` integer NOT NULL,
	`episode_id` integer NOT NULL,
	PRIMARY KEY(`grab_id`, `episode_id`),
	FOREIGN KEY (`episode_id`) REFERENCES `podcasts_episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `podcasts_grab_episodes_episode_idx` ON `podcasts_grab_episodes` (`episode_id`);