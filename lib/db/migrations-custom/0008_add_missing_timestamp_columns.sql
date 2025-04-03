-- Add missing timestamp columns to documents table
DO $$ 
BEGIN
  -- Add created_at if it doesn't exist
  IF NOT EXISTS (SELECT FROM pg_attribute 
                WHERE attrelid = 'public.documents'::regclass
                AND attname = 'created_at'
                AND NOT attisdropped) THEN
    ALTER TABLE "documents" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;
  END IF;

  -- Add updated_at if it doesn't exist
  IF NOT EXISTS (SELECT FROM pg_attribute 
                WHERE attrelid = 'public.documents'::regclass
                AND attname = 'updated_at'
                AND NOT attisdropped) THEN
    ALTER TABLE "documents" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;
  END IF;
END $$; 