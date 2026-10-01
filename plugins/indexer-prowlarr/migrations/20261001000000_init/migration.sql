CREATE TABLE `prowlarr_pushed` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `prowlarr_tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`label` text NOT NULL UNIQUE
);
