CREATE TABLE `jobs_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`payload` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`dedupe_key` text,
	`run_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer NOT NULL,
	`lock_until` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_queue_due_idx` ON `jobs_queue` (`status`,`run_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_queue_dedupe_idx` ON `jobs_queue` (`dedupe_key`) WHERE "jobs_queue"."dedupe_key" IS NOT NULL AND "jobs_queue"."status" IN ('pending', 'running');--> statement-breakpoint
CREATE TABLE `jobs_schedules` (
	`name` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text,
	`interval_ms` integer NOT NULL,
	`next_run_at` integer NOT NULL,
	`last_run_at` integer
);
