CREATE TABLE `notifications_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`event` text NOT NULL,
	`title` text NOT NULL,
	`notifier_id` text NOT NULL,
	`notifier_name` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
