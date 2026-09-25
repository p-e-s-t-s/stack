CREATE TABLE `downloads_grab_units` (
	`grab_id` integer NOT NULL,
	`unit_id` integer NOT NULL,
	PRIMARY KEY(`grab_id`, `unit_id`),
	FOREIGN KEY (`grab_id`) REFERENCES `downloads_grabs`(`id`) ON UPDATE no action ON DELETE cascade
);
