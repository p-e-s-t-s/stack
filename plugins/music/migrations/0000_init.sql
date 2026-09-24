CREATE TABLE `music_albums` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_id` integer NOT NULL,
	`musicbrainz_id` text NOT NULL,
	`title` text NOT NULL,
	`primary_type` text,
	`secondary_types` text NOT NULL,
	`release_date` text,
	`cover_url` text,
	`monitored` integer NOT NULL,
	`release_id` text,
	`last_searched_at` integer,
	FOREIGN KEY (`media_id`) REFERENCES `library_media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `music_albums_musicbrainz_idx` ON `music_albums` (`media_id`,`musicbrainz_id`);--> statement-breakpoint
CREATE INDEX `music_albums_release_idx` ON `music_albums` (`release_date`);--> statement-breakpoint
CREATE TABLE `music_artists` (
	`media_id` integer PRIMARY KEY NOT NULL,
	`musicbrainz_id` text NOT NULL,
	`artist_type` text,
	`disambiguation` text,
	`country` text,
	`album_types` text NOT NULL,
	`secondary_types` text NOT NULL,
	`monitor_new` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `library_media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `music_artists_musicbrainz_id_unique` ON `music_artists` (`musicbrainz_id`);--> statement-breakpoint
CREATE TABLE `music_grab_albums` (
	`grab_id` integer NOT NULL,
	`album_id` integer NOT NULL,
	PRIMARY KEY(`grab_id`, `album_id`),
	FOREIGN KEY (`album_id`) REFERENCES `music_albums`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `music_track_files` (
	`file_id` integer PRIMARY KEY NOT NULL,
	`track_id` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `library_media_files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `music_tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `music_track_files_track_idx` ON `music_track_files` (`track_id`);--> statement-breakpoint
CREATE TABLE `music_tracks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`album_id` integer NOT NULL,
	`disc` integer NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`length_ms` integer,
	`recording_id` text,
	FOREIGN KEY (`album_id`) REFERENCES `music_albums`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `music_tracks_number_idx` ON `music_tracks` (`album_id`,`disc`,`number`);