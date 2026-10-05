CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'live' NOT NULL,
	`broker` text,
	`currency` text DEFAULT 'USD' NOT NULL,
	`starting_balance` real DEFAULT 0 NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ai_analysis` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`trade_id` text,
	`image_id` text,
	`kind` text NOT NULL,
	`model` text NOT NULL,
	`output` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_id`) REFERENCES `trade_images`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `broker_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`api_key_hash` text NOT NULL,
	`last_seen_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `broker_connections_api_key_hash_unique` ON `broker_connections` (`api_key_hash`);--> statement-breakpoint
CREATE TABLE `checklist_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_id` text NOT NULL,
	`user_id` text NOT NULL,
	`phase` text NOT NULL,
	`item` text NOT NULL,
	`checked` integer,
	`answer` text,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `kb_concepts` (
	`slug` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`area` text NOT NULL,
	`category` text NOT NULL,
	`definition` text NOT NULL,
	`confidence` text NOT NULL,
	`related` text DEFAULT '' NOT NULL,
	`exceptions` text DEFAULT '' NOT NULL,
	`examples` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `kb_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`concept_slug` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`locator` text DEFAULT '' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`concept_slug`) REFERENCES `kb_concepts`(`slug`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `market_context` (
	`trade_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`trend` text,
	`htf_bias` text,
	`session` text,
	`volatility` text,
	`atr` real,
	`near_key_level` integer,
	`details` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `mistake_types` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `monthly_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`month` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`biggest_improvement` text DEFAULT '' NOT NULL,
	`focus_next_month` text DEFAULT '' NOT NULL,
	`ai_summary` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `monthly_user_month` ON `monthly_reviews` (`user_id`,`month`);--> statement-breakpoint
CREATE TABLE `mt5_deals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`ticket` text NOT NULL,
	`position_id` text NOT NULL,
	`order_id` text,
	`time` integer NOT NULL,
	`type` text NOT NULL,
	`entry` text NOT NULL,
	`symbol` text NOT NULL,
	`volume` real NOT NULL,
	`price` real NOT NULL,
	`sl` real,
	`tp` real,
	`commission` real DEFAULT 0 NOT NULL,
	`swap` real DEFAULT 0 NOT NULL,
	`profit` real DEFAULT 0 NOT NULL,
	`magic` integer,
	`comment` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mt5_deal_account_ticket` ON `mt5_deals` (`account_id`,`ticket`);--> statement-breakpoint
CREATE TABLE `performance_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`as_of` integer NOT NULL,
	`balance` real NOT NULL,
	`equity` real,
	`source` text DEFAULT 'computed' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `psychology_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_id` text NOT NULL,
	`user_id` text NOT NULL,
	`phase` text NOT NULL,
	`emotion` text NOT NULL,
	`intensity` integer,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `psych_trade_phase` ON `psychology_entries` (`trade_id`,`phase`);--> statement-breakpoint
CREATE TABLE `risk_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text,
	`max_risk_pct` real,
	`max_daily_loss_pct` real,
	`max_weekly_loss_pct` real,
	`max_trades_per_day` integer,
	`max_consecutive_losses` integer,
	`min_rr` real,
	`trading_hours_start` text,
	`trading_hours_end` text,
	`restricted_days` text,
	`require_checklist` integer DEFAULT false NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `score_factors` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`weight` real NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `score_factors_user_key` ON `score_factors` (`user_id`,`key`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE TABLE `setups` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`strategy_id` text,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`strategy_id`) REFERENCES `strategies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `strategies` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'user' NOT NULL,
	`preferred_sessions` text DEFAULT '' NOT NULL,
	`preferred_pairs` text DEFAULT '' NOT NULL,
	`preferred_conditions` text DEFAULT '' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `strategy_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`strategy_id` text NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`is_required` integer DEFAULT true NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`kb_concept_slug` text,
	FOREIGN KEY (`strategy_id`) REFERENCES `strategies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `trade_factor_ratings` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_id` text NOT NULL,
	`user_id` text NOT NULL,
	`factor_key` text NOT NULL,
	`rating` integer NOT NULL,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_factor_unique` ON `trade_factor_ratings` (`trade_id`,`factor_key`);--> statement-breakpoint
CREATE TABLE `trade_images` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`storage_key` text NOT NULL,
	`thumb_key` text NOT NULL,
	`mime` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`bytes` integer NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `trade_links` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`ref_id` text NOT NULL,
	`score` real,
	`status` text DEFAULT 'suggested' NOT NULL,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_link_unique` ON `trade_links` (`trade_id`,`kind`,`ref_id`);--> statement-breakpoint
CREATE TABLE `trade_mistakes` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_id` text NOT NULL,
	`user_id` text NOT NULL,
	`mistake_key` text NOT NULL,
	`source` text DEFAULT 'user' NOT NULL,
	`cost_r` real,
	`note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_mistake_unique` ON `trade_mistakes` (`trade_id`,`mistake_key`);--> statement-breakpoint
CREATE TABLE `trade_notes` (
	`trade_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`why` text DEFAULT '' NOT NULL,
	`observed` text DEFAULT '' NOT NULL,
	`thesis` text DEFAULT '' NOT NULL,
	`what_happened` text DEFAULT '' NOT NULL,
	`did_well` text DEFAULT '' NOT NULL,
	`did_poorly` text DEFAULT '' NOT NULL,
	`would_change` text DEFAULT '' NOT NULL,
	`lesson` text DEFAULT '' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `trade_psychology` (
	`trade_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`confidence` integer,
	`discipline` integer,
	`followed_plan` integer,
	`fomo` integer DEFAULT false NOT NULL,
	`revenge` integer DEFAULT false NOT NULL,
	`moved_stop` integer DEFAULT false NOT NULL,
	`exited_early` integer DEFAULT false NOT NULL,
	`overtraded` integer DEFAULT false NOT NULL,
	`late_entry` integer DEFAULT false NOT NULL,
	`oversized` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`strategy_id` text,
	`setup_id` text,
	`seq` integer NOT NULL,
	`external_ref` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`symbol` text NOT NULL,
	`direction` text NOT NULL,
	`status` text DEFAULT 'closed' NOT NULL,
	`opened_at` integer NOT NULL,
	`closed_at` integer,
	`entry_price` real NOT NULL,
	`initial_stop` real,
	`take_profit` real,
	`exit_price` real,
	`size_lots` real,
	`risk_amount` real,
	`risk_pct` real,
	`gross_pnl` real,
	`commission` real DEFAULT 0 NOT NULL,
	`swap` real DEFAULT 0 NOT NULL,
	`fees` real DEFAULT 0 NOT NULL,
	`net_pnl` real,
	`pnl_pct` real,
	`r_multiple` real,
	`planned_rr` real,
	`session` text,
	`timeframe` text,
	`market_condition` text,
	`trend` text,
	`htf_bias` text,
	`setup_quality` text,
	`entry_confirmation` text,
	`confluences` text DEFAULT '' NOT NULL,
	`setup_score` real,
	`chart_url` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`strategy_id`) REFERENCES `strategies`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`setup_id`) REFERENCES `setups`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `trades_user_opened` ON `trades` (`user_id`,`opened_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `trades_user_seq` ON `trades` (`user_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `trades_account_external` ON `trades` (`account_id`,`external_ref`);--> statement-breakpoint
CREATE TABLE `tradingview_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`symbol` text,
	`timeframe` text,
	`price` real,
	`side` text,
	`setup` text,
	`alert_time` integer,
	`message` text,
	`raw` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`base_currency` text DEFAULT 'USD' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `webhook_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_tokens_token_hash_unique` ON `webhook_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `weekly_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`week_start` text NOT NULL,
	`followed_rules` text DEFAULT '' NOT NULL,
	`overtraded` text DEFAULT '' NOT NULL,
	`forced_setups` text DEFAULT '' NOT NULL,
	`respected_risk` text DEFAULT '' NOT NULL,
	`followed_plan` text DEFAULT '' NOT NULL,
	`emotions` text DEFAULT '' NOT NULL,
	`lost_discipline` text DEFAULT '' NOT NULL,
	`triggers` text DEFAULT '' NOT NULL,
	`keep_doing` text DEFAULT '' NOT NULL,
	`stop_doing` text DEFAULT '' NOT NULL,
	`change` text DEFAULT '' NOT NULL,
	`focus_next_week` text DEFAULT '' NOT NULL,
	`ai_summary` text,
	`completed_at` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_user_week` ON `weekly_reviews` (`user_id`,`week_start`);