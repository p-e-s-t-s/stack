CREATE TABLE `mediainfo_files` (
	`file_id` integer PRIMARY KEY,
	`fingerprint` text NOT NULL,
	`facts` text,
	`error` text,
	`probed_at` integer NOT NULL,
	CONSTRAINT `fk_mediainfo_files_file_id_library_media_files_id_fk` FOREIGN KEY (`file_id`) REFERENCES `library_media_files`(`id`) ON DELETE CASCADE
);
