'use server';

import { Pinecone } from '@pinecone-database/pinecone';

const INDEX_NAME = process.env.PINECONE_INDEX_NAME;
const API_KEY = process.env.PINECONE_API_KEY;
const ENVIRONMENT = process.env.PINECONE_ENVIRONMENT;
const INDEX_HOST = process.env.PINECONE_INDEX_HOST;

// --- Add Diagnostic Logging ---
console.log("--- Pinecone Env Vars Check ---");
console.log(`- PINECONE_API_KEY present: ${!!API_KEY}`); // Log presence, not the key itself for security
console.log(`- PINECONE_INDEX_NAME: ${INDEX_NAME}`);
console.log(`- PINECONE_ENVIRONMENT: ${ENVIRONMENT}`);
console.log(`- PINECONE_INDEX_HOST: ${INDEX_HOST}`);
console.log("-----------------------------");
// --- End Logging ---

// --- Environment Variable Validation ---
if (!API_KEY) {
  throw new Error('PINECONE_API_KEY environment variable is not defined.');
}
if (!INDEX_NAME) {
   throw new Error('PINECONE_INDEX_NAME environment variable is not defined.');
}
// You can keep or remove the other checks/warnings for INDEX_HOST/ENVIRONMENT
// as they won't affect the constructor call directly in this approach.

// --- Initialize Client (Minimal Config) ---
console.log('Initializing Pinecone client with: apiKey only (minimal config)');
let pineconeInstance: Pinecone;
try {
  // Initialize with ONLY the apiKey
  pineconeInstance = new Pinecone({
    apiKey: API_KEY,
  });
} catch (e) {
   console.error("Error during Pinecone client minimal initialization:", e);
   // If even this minimal init fails, re-throw to see the error
   throw e;
}

// Export the initialized instance
export const pineconeClient = pineconeInstance;

// --- Helper Function ---
export const getPineconeIndex = () => {
  // Re-check index name here just in case, though checked above
  if (!INDEX_NAME) {
     throw new Error('PINECONE_INDEX_NAME is missing, cannot get index.');
  }
  return pineconeClient.index(INDEX_NAME);
}; 