PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_library_media` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text,
	`year` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_library_media`("id", "title", "year") SELECT "id", "title", "year" FROM `library_media`;--> statement-breakpoint
DROP TABLE `library_media`;--> statement-breakpoint
ALTER TABLE `__new_library_media` RENAME TO `library_media`;--> statement-breakpoint
PRAGMA foreign_keys=ON;