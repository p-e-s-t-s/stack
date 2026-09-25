DROP INDEX `decision_profiles_name_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `decision_profiles_family_name_idx` ON `decision_profiles` (`family`,`name`);