ALTER TABLE "Document" ADD COLUMN "fileUrl" text;--> statement-breakpoint
ALTER TABLE "Document" ADD COLUMN "fileName" text;--> statement-breakpoint
ALTER TABLE "Document" ADD COLUMN "fileSize" varchar(20);--> statement-breakpoint
ALTER TABLE "Document" ADD COLUMN "fileType" varchar(100);--> statement-breakpoint
ALTER TABLE "Document" ADD COLUMN "processingStatus" varchar;