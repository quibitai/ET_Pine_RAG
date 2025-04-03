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
  
  -- Add user_id if it doesn't exist
  IF NOT EXISTS (SELECT FROM pg_attribute
                WHERE attrelid = 'public.documents'::regclass
                AND attname = 'user_id'
                AND NOT attisdropped) THEN
    ALTER TABLE "documents" ADD COLUMN "user_id" text NOT NULL;
    -- Note: This will fail on tables with existing data unless they're empty
    -- For production with existing data, you might need:
    -- 1. ALTER TABLE "documents" ADD COLUMN "user_id" text NULL;
    -- 2. UPDATE "documents" SET "user_id" = 'default-user-id';
    -- 3. ALTER TABLE "documents" ALTER COLUMN "user_id" SET NOT NULL;
  END IF;
END $$; 