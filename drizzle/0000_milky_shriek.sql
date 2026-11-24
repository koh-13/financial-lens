CREATE TABLE `analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`doc_id` text NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analyses_owner` ON `analyses` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `filings` (
	`doc_id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`period_end` text,
	`submitted` text NOT NULL,
	`csv_flag` text NOT NULL,
	`pdf_flag` text NOT NULL,
	`doc_type` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `filings_code` ON `filings` (`code`,`period_end`,`submitted`);--> statement-breakpoint
CREATE TABLE `indexed_dates` (
	`date` text PRIMARY KEY NOT NULL
);
