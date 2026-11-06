CREATE TABLE `paper_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user` text NOT NULL,
	`wallet` text,
	`cycle` integer NOT NULL,
	`data` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`last_trade` text,
	`closed` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `accounts_cycle` ON `paper_accounts` (`cycle`);--> statement-breakpoint
CREATE TABLE `paper_cycles` (
	`id` integer PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`pool_lamports` integer DEFAULT 0 NOT NULL,
	`snapshot` text,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `paper_fills` (
	`id` text PRIMARY KEY NOT NULL,
	`account` text NOT NULL,
	`intent` text NOT NULL,
	`data` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fill_intent` ON `paper_fills` (`account`,`intent`);--> statement-breakpoint
CREATE TABLE `paper_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `paper_nonces` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`message` text NOT NULL,
	`expires` integer NOT NULL,
	`used` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `paper_payouts` (
	`id` text PRIMARY KEY NOT NULL,
	`cycle` integer NOT NULL,
	`wallet` text NOT NULL,
	`rank` integer NOT NULL,
	`lamports` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`tx` text
);
--> statement-breakpoint
CREATE TABLE `paper_quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`account` text NOT NULL,
	`data` text NOT NULL,
	`expires` integer NOT NULL,
	`used` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `paper_sessions` (
	`hash` text PRIMARY KEY NOT NULL,
	`user` text NOT NULL,
	`wallet` text,
	`expires` integer NOT NULL
);
