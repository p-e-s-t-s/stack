CREATE TABLE `themes_preferences` (
	`user_id` integer PRIMARY KEY,
	`theme_id` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `themes_settings` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
