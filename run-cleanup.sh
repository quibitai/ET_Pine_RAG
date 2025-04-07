#!/bin/bash

# Extract credentials from .env.local
export PINECONE_API_KEY=$(grep PINECONE_API_KEY .env.local | cut -d= -f2)

# Check available indexes first
echo "Checking available Pinecone indexes..."
npx tsx scripts/pinecone-list-indexes.ts

echo "Enter the Pinecone index name to clean (press Enter to use the default 'et'):"
read index_name
if [ -z "$index_name" ]; then
  export PINECONE_INDEX_NAME="et"
else
  export PINECONE_INDEX_NAME="$index_name"
fi

echo "Running cleanup on index: $PINECONE_INDEX_NAME"
node scripts/pinecone-cleanup.js
