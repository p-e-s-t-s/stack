ALTER TABLE `auth_api_keys` ADD `role` text DEFAULT 'manager' NOT NULL;--> statement-breakpoint
ALTER TABLE `auth_api_keys` ADD `user_id` integer REFERENCES auth_users(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD `last_seen_at` integer;--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD `address` text;--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD `user_agent` text;--> statement-breakpoint
ALTER TABLE `auth_users` ADD `role` text DEFAULT 'admin' NOT NULL;--> statement-breakpoint
ALTER TABLE `auth_users` ADD `disabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `auth_users` ADD `last_login_at` integer;
