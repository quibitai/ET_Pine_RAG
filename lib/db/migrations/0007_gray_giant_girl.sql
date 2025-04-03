-- First, check if the old table exists and rename it if it does
DO $$ 
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'Document') THEN
    ALTER TABLE "Document" RENAME TO "documents";
  END IF;
END $$;
--> statement-breakpoint

-- Only add the required new columns (status_message, total_chunks, processed_chunks)
-- These are the ones we really need for the chunked processing feature
DO $$ 
BEGIN
  -- Add status_message if it doesn't exist
  IF NOT EXISTS (SELECT FROM pg_attribute 
                WHERE attrelid = 'public.documents'::regclass
                AND attname = 'status_message'
                AND NOT attisdropped) THEN
    ALTER TABLE "documents" ADD COLUMN "status_message" text;
  END IF;

  -- Add total_chunks if it doesn't exist
  IF NOT EXISTS (SELECT FROM pg_attribute 
                WHERE attrelid = 'public.documents'::regclass
                AND attname = 'total_chunks'
                AND NOT attisdropped) THEN
    ALTER TABLE "documents" ADD COLUMN "total_chunks" integer;
  END IF;

  -- Add processed_chunks if it doesn't exist
  IF NOT EXISTS (SELECT FROM pg_attribute 
                WHERE attrelid = 'public.documents'::regclass
                AND attname = 'processed_chunks'
                AND NOT attisdropped) THEN
    ALTER TABLE "documents" ADD COLUMN "processed_chunks" integer DEFAULT 0 NOT NULL;
  END IF;
END $$;
--> statement-breakpoint

-- Handle the naming inconsistency between the schema definitions
DO $$
BEGIN
  -- Check if the created_at column exists but createdAt doesn't
  IF EXISTS (SELECT FROM pg_attribute 
            WHERE attrelid = 'public.documents'::regclass
            AND attname = 'created_at'
            AND NOT attisdropped) AND
     NOT EXISTS (SELECT FROM pg_attribute 
                WHERE attrelid = 'public.documents'::regclass
                AND attname = 'createdAt'
                AND NOT attisdropped) THEN
    
    -- Add a createdAt column that's a copy of created_at for foreign key references
    ALTER TABLE "documents" ADD COLUMN "createdAt" timestamp;
    UPDATE "documents" SET "createdAt" = "created_at";
    ALTER TABLE "documents" ALTER COLUMN "createdAt" SET NOT NULL;
  END IF;
END $$;
--> statement-breakpoint

-- Update foreign key constraints if needed
DO $$ 
BEGIN
  -- Only drop the constraint if it exists
  IF EXISTS (SELECT FROM pg_constraint 
            WHERE conname = 'Suggestion_documentId_documentCreatedAt_Document_id_createdAt_fk') THEN
    ALTER TABLE "Suggestion" DROP CONSTRAINT "Suggestion_documentId_documentCreatedAt_Document_id_createdAt_fk";

    -- Add the new constraint referencing the renamed table with the proper column name 
    -- (using createdAt to match the schema foreign key definition)
    ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_documentId_documentCreatedAt_documents_id_createdAt_fk" 
      FOREIGN KEY ("documentId","documentCreatedAt") 
      REFERENCES "public"."documents"("id","createdAt") 
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
