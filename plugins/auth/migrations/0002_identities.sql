ALTER TABLE `auth_users` DROP COLUMN `password_hash`;--> statement-breakpoint
CREATE TABLE `auth_identities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_login_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_identities_subject_idx` ON `auth_identities` (`provider`,`subject`);--> statement-breakpoint
CREATE INDEX `auth_identities_user_idx` ON `auth_identities` (`user_id`);
