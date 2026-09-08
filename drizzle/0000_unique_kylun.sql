CREATE TABLE `communication_samples` (
	`id` text PRIMARY KEY NOT NULL,
	`sourceType` text NOT NULL,
	`audience` text NOT NULL,
	`tone` text NOT NULL,
	`originalChinese` text,
	`originalEnglish` text,
	`minimalRevision` text NOT NULL,
	`naturalRevision` text NOT NULL,
	`shouldClarify` integer DEFAULT false NOT NULL,
	`clarificationQuestions` text,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `detected_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`sampleId` text NOT NULL,
	`category` text NOT NULL,
	`skillKey` text NOT NULL,
	`originalText` text NOT NULL,
	`correctedText` text NOT NULL,
	`explanationZh` text NOT NULL,
	`severity` text NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`sampleId`) REFERENCES `communication_samples`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_issues_sample` ON `detected_issues` (`sampleId`);--> statement-breakpoint
CREATE TABLE `expressions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`chineseMeaning` text NOT NULL,
	`pattern` text,
	`example` text,
	`scenario` text,
	`notes` text,
	`sourceSampleId` text,
	`masteryStatus` text DEFAULT 'new' NOT NULL,
	`nextReviewAt` text,
	`status` text DEFAULT 'active' NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`sourceSampleId`) REFERENCES `communication_samples`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_expressions_mastery` ON `expressions` (`masteryStatus`);--> statement-breakpoint
CREATE INDEX `idx_expressions_status` ON `expressions` (`status`);--> statement-breakpoint
CREATE TABLE `review_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`taskId` text NOT NULL,
	`userAnswer` text NOT NULL,
	`usedHint` integer DEFAULT false NOT NULL,
	`revealedAnswer` integer DEFAULT false NOT NULL,
	`aiScore` integer,
	`coreMeaningCorrect` integer,
	`grammarCorrect` integer,
	`toneAppropriate` integer,
	`feedbackZh` text,
	`improvedAnswer` text,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`taskId`) REFERENCES `review_tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_attempts_task` ON `review_attempts` (`taskId`);--> statement-breakpoint
CREATE TABLE `review_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`taskType` text NOT NULL,
	`skillId` text,
	`expressionId` text,
	`promptZh` text NOT NULL,
	`context` text,
	`keywords` text,
	`referenceAnswer` text NOT NULL,
	`acceptableAnswers` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`scheduledAt` text NOT NULL,
	`completedAt` text,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`skillId`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`expressionId`) REFERENCES `expressions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_review_status_scheduled` ON `review_tasks` (`status`,`scheduledAt`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`skillKey` text NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`explanationZh` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skills_skillKey_unique` ON `skills` (`skillKey`);--> statement-breakpoint
CREATE INDEX `idx_skills_category` ON `skills` (`category`);