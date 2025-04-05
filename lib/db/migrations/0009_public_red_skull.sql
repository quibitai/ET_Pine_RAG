ALTER TABLE "documents" RENAME COLUMN "user_id" TO "userId";--> statement-breakpoint
ALTER TABLE "documents" RENAME COLUMN "fileUrl" TO "blobUrl";--> statement-breakpoint
ALTER TABLE "documents" RENAME COLUMN "status_message" TO "statusMessage";--> statement-breakpoint
ALTER TABLE "documents" RENAME COLUMN "total_chunks" TO "totalChunks";--> statement-breakpoint
ALTER TABLE "documents" RENAME COLUMN "processed_chunks" TO "processedChunks";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "title" text NOT NULL;