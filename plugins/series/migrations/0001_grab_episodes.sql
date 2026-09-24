CREATE TABLE `series_grab_episodes` (
	`grab_id` integer NOT NULL,
	`episode_id` integer NOT NULL,
	PRIMARY KEY(`grab_id`, `episode_id`),
	FOREIGN KEY (`episode_id`) REFERENCES `series_episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `series_grab_episodes_episode_idx` ON `series_grab_episodes` (`episode_id`);