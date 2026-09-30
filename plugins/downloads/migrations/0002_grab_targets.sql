ALTER TABLE `downloads_grabs` ADD `target_id` integer REFERENCES library_targets(id) ON DELETE cascade;
