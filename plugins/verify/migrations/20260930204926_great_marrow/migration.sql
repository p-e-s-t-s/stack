CREATE TABLE `verify_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`grab_id` integer NOT NULL,
	`title` text NOT NULL,
	`files` text NOT NULL,
	`findings` text NOT NULL,
	`outcome` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `verify_settings` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
