import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
config({
  path: '.env.production',
});

const resetAndMigrate = async () => {
  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL is not defined');
  }

  console.log('🔄 Starting database reset and migration process...');

  const connection = postgres(process.env.POSTGRES_URL, { max: 1 });
  const db = drizzle(connection);

  try {
    // Read and execute the reset SQL script
    console.log('💥 Dropping existing tables...');
    const resetSQL = fs.readFileSync(path.join(process.cwd(), 'scripts', 'reset-db.sql'), 'utf8');
    await connection.unsafe(resetSQL);
    console.log('✅ Tables dropped successfully');

    // Run the new migration
    console.log('⏳ Running new migration...');
    const start = Date.now();
    await migrate(db, { migrationsFolder: './lib/db/migrations' });
    const end = Date.now();
    console.log('✅ Migration completed in', end - start, 'ms');

    console.log('🎉 Database reset and migration successful!');
  } catch (error) {
    console.error('❌ Reset and migration failed:', error);
    throw error;
  } finally {
    await connection.end();
  }
};

resetAndMigrate().catch((err) => {
  console.error('❌ Script failed:', err);
  process.exit(1);
}); 