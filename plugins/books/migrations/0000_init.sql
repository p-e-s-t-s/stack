CREATE TABLE `books_authors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`openlibrary_id` text NOT NULL,
	`name` text NOT NULL,
	`overview` text,
	`photo_url` text,
	`alternate_names` text NOT NULL,
	`refreshed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `books_authors_openlibrary_id_unique` ON `books_authors` (`openlibrary_id`);--> statement-breakpoint
CREATE TABLE `books_book_files` (
	`file_id` integer PRIMARY KEY NOT NULL,
	`book_id` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `library_media_files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books_books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `books_book_files_book_idx` ON `books_book_files` (`book_id`);--> statement-breakpoint
CREATE TABLE `books_books` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`author_id` integer NOT NULL,
	`openlibrary_id` text NOT NULL,
	`title` text NOT NULL,
	`subtitle` text,
	`year` integer,
	`release_date` text,
	`cover_url` text,
	`editions` integer,
	FOREIGN KEY (`author_id`) REFERENCES `books_authors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `books_books_openlibrary_idx` ON `books_books` (`author_id`,`openlibrary_id`);--> statement-breakpoint
CREATE INDEX `books_books_release_idx` ON `books_books` (`release_date`);--> statement-breakpoint
CREATE TABLE `books_followed` (
	`media_id` integer PRIMARY KEY NOT NULL,
	`author_id` integer NOT NULL,
	`monitor_new` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `library_media_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `books_authors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `books_followed_author_idx` ON `books_followed` (`author_id`);--> statement-breakpoint
CREATE TABLE `books_grab_books` (
	`grab_id` integer NOT NULL,
	`book_id` integer NOT NULL,
	PRIMARY KEY(`grab_id`, `book_id`),
	FOREIGN KEY (`book_id`) REFERENCES `books_books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `books_monitoring` (
	`media_id` integer NOT NULL,
	`book_id` integer NOT NULL,
	`monitored` integer NOT NULL,
	`last_searched_at` integer,
	PRIMARY KEY(`media_id`, `book_id`),
	FOREIGN KEY (`media_id`) REFERENCES `library_media_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books_books`(`id`) ON UPDATE no action ON DELETE cascade
);
