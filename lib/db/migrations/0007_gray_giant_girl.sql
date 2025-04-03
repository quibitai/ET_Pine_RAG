-- First, rename the existing table instead of dropping it
ALTER TABLE "Document" RENAME TO "documents";
--> statement-breakpoint

-- Add the new columns to the table
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now() NOT NULL;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "user_id" text;
UPDATE "documents" SET "user_id" = "userId" WHERE "user_id" IS NULL;
ALTER TABLE "documents" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint

-- Rename the old columns to match the new schema
ALTER TABLE "documents" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "documents" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "documents" RENAME COLUMN "fileName" TO "file_name";
ALTER TABLE "documents" RENAME COLUMN "fileType" TO "file_type";
ALTER TABLE "documents" RENAME COLUMN "fileSize" TO "file_size";
ALTER TABLE "documents" RENAME COLUMN "fileUrl" TO "blob_url";
ALTER TABLE "documents" RENAME COLUMN "processingStatus" TO "processing_status";
--> statement-breakpoint

-- Add the new columns
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "status_message" text;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "total_chunks" integer;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "processed_chunks" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint

-- Update the foreign key constraints
ALTER TABLE "Suggestion" DROP CONSTRAINT IF EXISTS "Suggestion_documentId_documentCreatedAt_Document_id_createdAt_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_documentId_documentCreatedAt_documents_id_created_at_fk" FOREIGN KEY ("documentId","documentCreatedAt") REFERENCES "public"."documents"("id","created_at") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
