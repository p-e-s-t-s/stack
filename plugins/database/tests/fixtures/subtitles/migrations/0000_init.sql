CREATE TABLE `subtitles_assignments` (
	`media_id` integer PRIMARY KEY NOT NULL,
	`profile` text NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `library_media`(`id`) ON UPDATE no action ON DELETE cascade
);
