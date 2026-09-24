CREATE TABLE `movies_details` (
	`media_id` integer PRIMARY KEY NOT NULL,
	`tmdb_id` integer NOT NULL,
	`imdb_id` text,
	`runtime_minutes` integer,
	`original_language` text,
	`in_cinemas` text,
	`digital_release` text,
	`physical_release` text,
	`minimum_availability` text DEFAULT 'released' NOT NULL,
	`backdrop_url` text,
	`genres` text,
	`last_searched_at` integer,
	FOREIGN KEY (`media_id`) REFERENCES `library_media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `movies_details_tmdb_id_unique` ON `movies_details` (`tmdb_id`);