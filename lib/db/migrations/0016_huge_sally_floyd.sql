ALTER TABLE "Suggestion" DROP CONSTRAINT "Suggestion_id";--> statement-breakpoint
ALTER TABLE "Vote_v2" DROP CONSTRAINT "Vote_v2_chatId_messageId";--> statement-breakpoint
ALTER TABLE "User" ALTER COLUMN "password" SET DATA TYPE varchar(64);--> statement-breakpoint
ALTER TABLE "User" ALTER COLUMN "password" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_id_pk" PRIMARY KEY("id");--> statement-breakpoint
ALTER TABLE "Vote_v2" ADD CONSTRAINT "Vote_v2_chatId_messageId_pk" PRIMARY KEY("chatId","messageId");