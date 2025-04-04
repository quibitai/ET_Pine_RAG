import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

config({
  path: '.env.local',
});

const runPush = async () => {
  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL is not defined');
  }

  const connection = postgres(process.env.POSTGRES_URL, { max: 1 });
  const db = drizzle(connection, { schema });

  console.log('⏳ Running manual database schema update...');

  try {
    // Execute specific ALTER TABLE statements to rename columns
    console.log('Renaming database columns to match schema...');
    
    await connection.unsafe(`
      -- Rename columns if they exist
      DO $$
      BEGIN
        -- Check if created_at exists and createdAt doesn't
        IF EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'created_at'
        ) AND NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'createdAt'
        ) THEN
          ALTER TABLE "documents" RENAME COLUMN "created_at" TO "createdAt";
        END IF;

        -- Check if updated_at exists and updatedAt doesn't
        IF EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'updated_at'
        ) AND NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'updatedAt'
        ) THEN
          ALTER TABLE "documents" RENAME COLUMN "updated_at" TO "updatedAt";
        END IF;

        -- Check if file_name exists and fileName doesn't
        IF EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'file_name'
        ) AND NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'fileName'
        ) THEN
          ALTER TABLE "documents" RENAME COLUMN "file_name" TO "fileName";
        END IF;

        -- Check if file_type exists and fileType doesn't
        IF EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'file_type'
        ) AND NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'fileType'
        ) THEN
          ALTER TABLE "documents" RENAME COLUMN "file_type" TO "fileType";
        END IF;

        -- Check if file_size exists and fileSize doesn't
        IF EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'file_size'
        ) AND NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'fileSize'
        ) THEN
          ALTER TABLE "documents" RENAME COLUMN "file_size" TO "fileSize";
        END IF;

        -- Check if blob_url exists and fileUrl doesn't
        IF EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'blob_url'
        ) AND NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'fileUrl'
        ) THEN
          ALTER TABLE "documents" RENAME COLUMN "blob_url" TO "fileUrl";
        END IF;

        -- Check if fileUrl exists and blobUrl doesn't
        IF EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'fileUrl'
        ) AND NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'blobUrl'
        ) THEN
          ALTER TABLE "documents" RENAME COLUMN "fileUrl" TO "blobUrl";
        END IF;

        -- Check if status_message exists and statusMessage doesn't
        IF EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'status_message'
        ) AND NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'statusMessage'
        ) THEN
          ALTER TABLE "documents" RENAME COLUMN "status_message" TO "statusMessage";
        END IF;

        -- Check if total_chunks exists and totalChunks doesn't
        IF EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'total_chunks'
        ) AND NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'totalChunks'
        ) THEN
          ALTER TABLE "documents" RENAME COLUMN "total_chunks" TO "totalChunks";
        END IF;

        -- Check if processed_chunks exists and processedChunks doesn't
        IF EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'processed_chunks'
        ) AND NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'processedChunks'
        ) THEN
          ALTER TABLE "documents" RENAME COLUMN "processed_chunks" TO "processedChunks";
        END IF;

        -- Check if processing_status exists and processingStatus doesn't
        IF EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'processing_status'
        ) AND NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'processingStatus'
        ) THEN
          ALTER TABLE "documents" RENAME COLUMN "processing_status" TO "processingStatus";
        END IF;

        -- Check if user_id exists and userId doesn't
        IF EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'user_id'
        ) AND NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'userId'
        ) THEN
          ALTER TABLE "documents" RENAME COLUMN "user_id" TO "userId";
        END IF;

        -- Handle special case for title column that's not in our schema
        -- Check if the title column exists
        IF EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'title'
        ) THEN
          -- Make title column nullable first
          ALTER TABLE "documents" ALTER COLUMN "title" DROP NOT NULL;
          
          -- Set title to be equal to fileName for all rows where title is NULL
          UPDATE "documents" SET "title" = "fileName" WHERE "title" IS NULL;
          
          -- Add a trigger to auto-populate title from fileName on insert
          DROP TRIGGER IF EXISTS set_title_from_filename ON "documents";
          
          CREATE OR REPLACE FUNCTION set_title_from_filename() 
          RETURNS TRIGGER AS $trigger$
          BEGIN
            IF NEW.title IS NULL THEN
              NEW.title := NEW.fileName;
            END IF;
            RETURN NEW;
          END;
          $trigger$ LANGUAGE plpgsql;
          
          CREATE TRIGGER set_title_from_filename
          BEFORE INSERT ON "documents"
          FOR EACH ROW
          EXECUTE FUNCTION set_title_from_filename();
        END IF;

        -- Copy user_id to userId and vice versa if either is NULL
        IF EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'user_id'
        ) AND EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'userId'
        ) THEN
          -- Skip the data synchronization for now to avoid type casting errors
          RAISE NOTICE 'Skipping userId/user_id synchronization due to type differences';
          -- These operations would need explicit type casts which we'll handle in a future migration
          -- UPDATE "documents" SET "userId" = "user_id" WHERE "userId" IS NULL AND "user_id" IS NOT NULL;
          -- UPDATE "documents" SET "user_id" = "userId" WHERE "user_id" IS NULL AND "userId" IS NOT NULL;
        END IF;

        -- Copy fileUrl to blobUrl and vice versa if either is NULL
        IF EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'fileUrl'
        ) AND EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'blobUrl'
        ) THEN
          -- Update rows where blobUrl is NULL but fileUrl has a value
          UPDATE "documents" SET "blobUrl" = "fileUrl" WHERE "blobUrl" IS NULL AND "fileUrl" IS NOT NULL;
          -- Update rows where fileUrl is NULL but blobUrl has a value
          UPDATE "documents" SET "fileUrl" = "blobUrl" WHERE "fileUrl" IS NULL AND "blobUrl" IS NOT NULL;
        END IF;

        -- Copy status_message to statusMessage and vice versa if either is NULL
        IF EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'status_message'
        ) AND EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'statusMessage'
        ) THEN
          -- Update rows where statusMessage is NULL but status_message has a value
          UPDATE "documents" SET "statusMessage" = "status_message" WHERE "statusMessage" IS NULL AND "status_message" IS NOT NULL;
          -- Update rows where status_message is NULL but statusMessage has a value
          UPDATE "documents" SET "status_message" = "statusMessage" WHERE "status_message" IS NULL AND "statusMessage" IS NOT NULL;
        END IF;

        -- Copy total_chunks to totalChunks and vice versa if either is NULL
        IF EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'total_chunks'
        ) AND EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'totalChunks'
        ) THEN
          -- Update rows where totalChunks is NULL but total_chunks has a value
          UPDATE "documents" SET "totalChunks" = "total_chunks" WHERE "totalChunks" IS NULL AND "total_chunks" IS NOT NULL;
          -- Update rows where total_chunks is NULL but totalChunks has a value
          UPDATE "documents" SET "total_chunks" = "totalChunks" WHERE "total_chunks" IS NULL AND "totalChunks" IS NOT NULL;
        END IF;

        -- Copy processed_chunks to processedChunks and vice versa if either is NULL
        IF EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'processed_chunks'
        ) AND EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'processedChunks'
        ) THEN
          -- Update rows where processedChunks is NULL but processed_chunks has a value
          UPDATE "documents" SET "processedChunks" = "processed_chunks" WHERE "processedChunks" IS NULL AND "processed_chunks" IS NOT NULL;
          -- Update rows where processed_chunks is NULL but processedChunks has a value
          UPDATE "documents" SET "processed_chunks" = "processedChunks" WHERE "processed_chunks" IS NULL AND "processedChunks" IS NOT NULL;
        END IF;

        -- Create missing columns with defaults from corresponding columns if they exist
        -- If userId doesn't exist but user_id does
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'userId'
        ) AND EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'user_id'
        ) THEN
          ALTER TABLE "documents" ADD COLUMN "userId" TEXT;
          UPDATE "documents" SET "userId" = "user_id";
          ALTER TABLE "documents" ALTER COLUMN "userId" SET NOT NULL;
        END IF;

        -- If blobUrl doesn't exist but fileUrl does
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'blobUrl'
        ) AND EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'documents' AND column_name = 'fileUrl'
        ) THEN
          ALTER TABLE "documents" ADD COLUMN "blobUrl" TEXT;
          UPDATE "documents" SET "blobUrl" = "fileUrl";
          ALTER TABLE "documents" ALTER COLUMN "blobUrl" SET NOT NULL;
        END IF;
      END
      $$;
    `);

    console.log('✅ Database schema updated successfully');
  } catch (error) {
    console.error('❌ Error updating database schema');
    console.error(error);
  } finally {
    await connection.end();
  }
};

runPush().catch((err) => {
  console.error('❌ Push operation failed');
  console.error(err);
  process.exit(1);
}); 