ALTER TABLE "documents" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint
ALTER TABLE "documents" RENAME COLUMN "updated_at" TO "updatedAt";--> statement-breakpoint
ALTER TABLE "documents" RENAME COLUMN "file_name" TO "fileName";--> statement-breakpoint
ALTER TABLE "documents" RENAME COLUMN "file_type" TO "fileType";--> statement-breakpoint
ALTER TABLE "documents" RENAME COLUMN "file_size" TO "fileSize";--> statement-breakpoint
ALTER TABLE "documents" RENAME COLUMN "blob_url" TO "fileUrl";--> statement-breakpoint
ALTER TABLE "documents" RENAME COLUMN "processing_status" TO "processingStatus";--> statement-breakpoint
ALTER TABLE "Suggestion" DROP CONSTRAINT "Suggestion_documentId_documentCreatedAt_documents_id_created_at_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_documentId_documentCreatedAt_documents_id_createdAt_fk" FOREIGN KEY ("documentId","documentCreatedAt") REFERENCES "public"."documents"("id","createdAt") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
