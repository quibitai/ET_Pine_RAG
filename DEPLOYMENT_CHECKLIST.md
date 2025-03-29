# Deployment Checklist for ET Pine RAG

This checklist ensures all necessary steps are completed for successful deployment to Vercel.

## Pre-Deployment Environment Variables

Ensure the following environment variables are set in Vercel's project settings:

- [ ] `GOOGLE_API_KEY` - API key for Google AI services
- [ ] `GOOGLE_GENERATIVE_AI_API_KEY` - Same as Google API key
- [ ] `PINECONE_API_KEY` - API key for Pinecone vector database
- [ ] `PINECONE_INDEX_HOST` - Pinecone index host URL (e.g., https://et-mf0m9e4.svc.aped-4627-b74a.pinecone.io)
- [ ] `PINECONE_INDEX_NAME` - Name of the Pinecone index (e.g., pine-rag)
- [ ] `REPLICATE_API_TOKEN` - API token for Replicate embedding generation
- [ ] `AUTH_SECRET` - Random secret for Next Auth (use a strong, randomly generated value)
- [ ] `TAVILY_API_KEY` - (Optional) API key for Tavily web search
- [ ] `OPENAI_API_KEY` - (Optional) API key for OpenAI services

## Vercel Storage Configuration

- [ ] Set up Vercel Postgres:
  - Go to Vercel Dashboard > Storage > Create New > Postgres Database
  - Connect to your project
  - Note: This will automatically set `POSTGRES_URL` and related variables

- [ ] Set up Vercel Blob:
  - Go to Vercel Dashboard > Storage > Create New > Blob Storage
  - Connect to your project
  - Note: This will automatically set `BLOB_READ_WRITE_TOKEN`

## Pre-Deployment Code Check

- [x] Remove all local development fallbacks
  - Removed fallback blob storage implementation
  - Removed references to placeholder URLs in RAG processor
  
- [x] Update all imports to use native fetch API
  - Removed node-fetch dependency
  - Updated all fetch calls to use native fetch

- [x] Ensure all API routes have proper runtime declarations
  - Added `export const runtime = 'nodejs';` to all API routes

- [x] Implement DOCX file parsing
  - Added mammoth.js library for DOCX processing
  - Implemented extractTextFromDOCX function

## Deployment Steps

1. [ ] Push all changes to your GitHub repository
2. [ ] Create a new project in Vercel
   - Connect to your GitHub repository
   - Configure the build settings (should be automatic for Next.js)
3. [ ] Add all required environment variables
4. [ ] Deploy the project
5. [ ] Verify that the application is running correctly:
   - Test user authentication
   - Test document uploads
   - Test RAG processing
   - Test chat with context from uploaded documents

## Post-Deployment Verification

- [ ] Verify that file uploads work correctly
- [ ] Verify that RAG processing works correctly
- [ ] Verify that chat with context works correctly
- [ ] Check logs for any errors or warnings

## Troubleshooting

If you encounter issues during deployment:

1. Check the Vercel deployment logs for errors
2. Verify that all environment variables are set correctly
3. Ensure the Vercel Blob store is properly configured
4. Check that the Pinecone index is accessible and properly configured 