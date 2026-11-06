CREATE TABLE `market_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`fetched` integer NOT NULL,
	`expires` integer NOT NULL
);
