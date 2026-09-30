CREATE TABLE `import_operations` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`batch_id` text NOT NULL,
	`parent_id` integer,
	`media_id` integer NOT NULL,
	`target_id` integer,
	`type` text NOT NULL,
	`source` text,
	`dest` text NOT NULL,
	`method` text,
	`trash_path` text,
	`trash_size` integer,
	`fingerprint` text,
	`snapshot` text,
	`status` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`undone_at` integer,
	CONSTRAINT `fk_import_operations_media_id_library_media_items_id_fk` FOREIGN KEY (`media_id`) REFERENCES `library_media_items`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `import_operations_batch_idx` ON `import_operations` (`batch_id`);--> statement-breakpoint
CREATE INDEX `import_operations_media_idx` ON `import_operations` (`media_id`);--> statement-breakpoint
CREATE INDEX `import_operations_parent_idx` ON `import_operations` (`parent_id`);