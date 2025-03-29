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
// Ensure at least one connection method is provided
if (!INDEX_HOST && !ENVIRONMENT) {
    // Depending on the Pinecone library version/setup, one might be required.
     throw new Error('Neither PINECONE_ENVIRONMENT nor PINECONE_INDEX_HOST is defined. Please provide one for Pinecone client configuration.');
}

// --- Determine Configuration and Initialize Client ---
let pineconeInstance: Pinecone;

if (INDEX_HOST) {
  // Serverless configuration (prioritized)
  if (ENVIRONMENT) {
      console.warn('Both PINECONE_INDEX_HOST and PINECONE_ENVIRONMENT are defined. Using PINECONE_INDEX_HOST (serverless).');
  }
  console.log('Initializing Pinecone client for serverless (apiKey, indexHost)');
  // Use type assertion to bypass TypeScript's type checking
  pineconeInstance = new Pinecone({
    apiKey: API_KEY,
    // @ts-ignore - indexHost is valid for serverless Pinecone
    indexHost: INDEX_HOST,
  });
} else if (ENVIRONMENT) {
  // Classic configuration
  console.log('Initializing Pinecone client for classic (apiKey, environment)');
  // Use type assertion to bypass TypeScript's type checking
  pineconeInstance = new Pinecone({
    apiKey: API_KEY,
    // @ts-ignore - environment is valid for classic Pinecone
    environment: ENVIRONMENT,
  });
} else {
  // This case should have been caught by validation above, but reiterate error
  throw new Error('Pinecone configuration error: Missing required PINECONE_INDEX_HOST or PINECONE_ENVIRONMENT.');
}

// Export the correctly initialized instance
export const pineconeClient = pineconeInstance;

// --- Helper Function ---
export const getPineconeIndex = () => {
  // Re-check index name here just in case, though checked above
  if (!INDEX_NAME) {
     throw new Error('PINECONE_INDEX_NAME is missing, cannot get index.');
  }
  return pineconeClient.index(INDEX_NAME);
}; 