CREATE TABLE `indexers_status` (
	`indexer_id` text PRIMARY KEY NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`disabled_until` integer,
	`last_error` text,
	`last_success_at` integer,
	`last_rss_at` integer,
	`last_rss_guid` text
);
