CREATE TABLE `decision_custom_formats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`conditions` text NOT NULL,
	`include_in_file_name` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `decision_custom_formats_name_unique` ON `decision_custom_formats` (`name`);--> statement-breakpoint
CREATE TABLE `decision_profile_scores` (
	`profile_id` integer NOT NULL,
	`format_id` integer NOT NULL,
	`score` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `format_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `decision_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`format_id`) REFERENCES `decision_custom_formats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `decision_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`items` text NOT NULL,
	`cutoff` text NOT NULL,
	`min_format_score` integer DEFAULT 0 NOT NULL,
	`cutoff_format_score` integer DEFAULT 0 NOT NULL,
	`upgrades_allowed` integer DEFAULT true NOT NULL,
	`languages` text NOT NULL,
	`min_seeders` integer DEFAULT 1 NOT NULL,
	`min_age_minutes` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `decision_profiles_name_unique` ON `decision_profiles` (`name`);--> statement-breakpoint
CREATE TABLE `decision_quality_sizes` (
	`quality` text PRIMARY KEY NOT NULL,
	`min` integer DEFAULT 0 NOT NULL,
	`preferred` integer,
	`max` integer
);
--> statement-breakpoint
CREATE TABLE `decision_restrictions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`required` text NOT NULL,
	`ignored` text NOT NULL
);
