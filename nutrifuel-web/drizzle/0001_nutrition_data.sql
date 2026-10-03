CREATE TABLE `user_nutrition_data` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`snapshot` text NOT NULL,
	`revision` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_nutrition_data_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_nutrition_data_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
ALTER TABLE `user_nutrition_data` ADD CONSTRAINT `user_nutrition_data_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;