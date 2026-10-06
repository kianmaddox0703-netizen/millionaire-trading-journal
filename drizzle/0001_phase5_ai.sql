CREATE TABLE `coach_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `coach_conv_user` ON `coach_conversations` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `coach_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`tools` text DEFAULT '' NOT NULL,
	`model` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `coach_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `coach_msg_conv` ON `coach_messages` (`conversation_id`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ai_analysis` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`trade_id` text,
	`image_id` text,
	`kind` text NOT NULL,
	`period_key` text,
	`model` text NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL,
	`error` text,
	`output` text DEFAULT '' NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_id`) REFERENCES `trade_images`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_ai_analysis`("id", "user_id", "trade_id", "image_id", "kind", "model", "output", "created_at") SELECT "id", "user_id", "trade_id", "image_id", "kind", "model", "output", "created_at" FROM `ai_analysis`;--> statement-breakpoint
DROP TABLE `ai_analysis`;--> statement-breakpoint
ALTER TABLE `__new_ai_analysis` RENAME TO `ai_analysis`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ai_analysis_trade` ON `ai_analysis` (`trade_id`,`kind`);--> statement-breakpoint
CREATE INDEX `ai_analysis_period` ON `ai_analysis` (`user_id`,`kind`,`period_key`);--> statement-breakpoint
ALTER TABLE `market_context` ADD `status` text DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE `market_context` ADD `error` text;--> statement-breakpoint
ALTER TABLE `market_context` ADD `instrument` text;--> statement-breakpoint
ALTER TABLE `users` ADD `ai_auto_review` integer DEFAULT true NOT NULL;