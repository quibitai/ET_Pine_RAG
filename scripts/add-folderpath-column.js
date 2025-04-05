// Script to add folderPath column to the documents table
const { drizzle } = require('drizzle-orm/postgres-js');
const postgres = require('postgres');
const { sql } = require('drizzle-orm');
const dotenv = require('dotenv');

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

async function main() {
  console.log('Adding folderPath column to documents table...');
  
  // Get POSTGRES_URL from environment
  const databaseUrl = process.env.POSTGRES_URL;
  if (!databaseUrl) {
    console.error('ERROR: POSTGRES_URL environment variable is not set');
    process.exit(1);
  }
  
  // Connect to database
  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);
  
  try {
    // Add the column if it doesn't exist
    console.log('Executing SQL...');
    await db.execute(sql`
      ALTER TABLE "documents" 
      ADD COLUMN IF NOT EXISTS "folderPath" text;
    `);
    console.log('Column "folderPath" added successfully!');
  } catch (error) {
    console.error('Error adding column:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main(); 