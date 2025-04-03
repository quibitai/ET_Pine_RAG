# Development Roadmap & Checklist

**Project Goal:** Adapt the `ai-chatbot-main` template to use Gemini 2.5 Pro Experimental (`gemini-2.5-pro-exp-03-25`) and GPT-4o Mini, implement file uploads for a knowledge base using Pinecone for RAG, integrate Tavily for web search, and deploy on Vercel.

## Phase 1: Setup & Model Integration

**Goal:** Configure the base project, install core dependencies, and set up multiple AI models.

- [x] **1.1 Install Dependencies:**
  - In `package.json`: Add `@ai-sdk/google`, `@ai-sdk/openai`, `@pinecone-database/pinecone`, `@tavily/core`
  - Run `pnpm install`
- [x] **1.2 Configure Environment Variables:**
  - In `.env.local`: Define/Verify `GOOGLE_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENAI_API_KEY`, `PINECONE_API_KEY`, `PINECONE_ENVIRONMENT` (or `PINECONE_INDEX_HOST`), `TAVILY_API_KEY`
  - Ensure `POSTGRES_URL`, `BLOB_READ_WRITE_TOKEN`, `AUTH_SECRET` are correctly set (use `vercel link` & `vercel env pull` if using Vercel)
- [x] **1.3 Set Up Multiple Models:**
  - In `lib/ai/providers.ts`:
    - Import `google` from `@ai-sdk/google` and `openai` from `@ai-sdk/openai`
    - Configure Gemini 2.5 Pro Experimental: `google('models/gemini-2.5-pro-exp-03-25')`
    - Configure GPT-4o Mini: `openai('gpt-4o-mini')`
    - Set up a Gemini embedding model for RAG: `google('models/text-embedding-004')`
  - In `lib/ai/models.ts`:
    - Update model options in the UI dropdown
    - Set GPT-4o Mini as the default model
- [x] **1.4 Initial Testing:**
  - Run `pnpm dev`
  - Perform basic chat interactions to confirm models are responding
  - Verify model switching works via dropdown

## Phase 2: Tavily Web Search Integration

**Goal:** Enable the AI assistant to perform real-time web searches using Tavily.

- [x] **2.1 Create Tavily Search Tool:**
  - Create `lib/ai/tools/tavily-search.ts`
  - Implement AI SDK `tool()` using `@tavily/core` client. Define `query` parameter. `execute` function should call Tavily API and return results
- [x] **2.2 Enable Tavily Tool:**
  - In `app/(chat)/api/chat/route.ts`:
    - Import `tavilySearch` tool
    - Add `tavilySearch` to the `tools` object in `streamText`
    - Add its name to `experimental_activeTools` array
- [x] **2.3 Update System Prompt for Search:**
  - In `lib/ai/prompts.ts`: Modify `systemPrompt` with instructions on when to use `tavilySearch`
- [x] **2.4 Test Search:**
  - Run `pnpm dev`
  - Ask questions requiring current information to trigger the search tool. Verify results are incorporated

## Current Progress Note
We've successfully completed Phases 1 & 2! The application now has:
1. Multiple model integration:
   - GPT-4o Mini (default) from OpenAI
   - Gemini 2.5 Pro Experimental from Google
2. Tavily web search integration for real-time information
3. Technical improvements:
   - Fixed database connection with PostgreSQL Docker container
   - Corrected runtime issues by switching to Node.js runtime
   - Fixed API key configurations
   - Simplified model selection by removing unused reasoning model
   - Added extensive logging for easier debugging

## Phase 3: File Upload & Storage Foundation

**Goal:** Allow users to upload files, store them, and track metadata.

- [x] **3.1 Enhance Frontend for Uploads:**
  - In `components/` (e.g., `multimodal-input.tsx`): Add a file input UI element. Handle file selection and preview
- [x] **3.2 Adapt Upload API Route:**
  - In `app/(chat)/api/files/upload/route.ts`:
    - Update `FileSchema` in Zod validation for desired file types (PDF, TXT, DOCX etc.) and size limits
    - Ensure file is uploaded to Vercel Blob via `@vercel/blob`
    - Return blob URL and metadata
    - *Crucially:* Add logic to trigger the backend RAG processing (Phase 4.3) after successful Blob upload
- [x] **3.3 Update Database Schema:**
  - In `lib/db/schema.ts`: Define a new `pgTable` named `uploaded_files` with columns: `id` (UUID, PK), `userId` (FK to `User`), `fileName` (text), `fileType` (varchar), `blobUrl` (text), `uploadTimestamp` (timestamp), `ragStatus` (varchar, e.g., 'pending', 'processing', 'completed', 'failed')
  - Run `pnpm db:generate` to create the migration file
  - Run `pnpm db:migrate` (or `pnpm build` which includes migrate) to apply the schema change
- [x] **3.4 Implement Database Queries:**
  - In `lib/db/queries.ts`: Add functions `addUploadedFileMetadata`, `updateFileRagStatus`, `getUserFiles`
- [x] **3.5 Set Up Vercel Blob Storage:**
  - Create setup utility for Vercel Blob configuration (`scripts/setup-blob-store.js`)
  - Add detailed documentation for Blob setup (`VERCEL_BLOB_SETUP.md`)
  - Implement robust error handling and fallback mechanism for development

## Phase 3 Progress Update
We've completed Phase 3 with the following achievements:
1. Added support for multiple document types (PDF, TXT, DOCX) in the frontend
2. Enhanced file upload UX with proper preview and icons for different document types
3. Implemented the upload API route with comprehensive error handling
4. Set up the database schema and added migration files for tracking uploaded files
5. Created utility functions for managing file metadata in the database
6. Implemented a robust Vercel Blob storage setup with a fallback mechanism for development
7. Added detailed logging throughout the upload process for better debugging
8. Created a setup script and documentation for Vercel Blob configuration

## Phase 4: RAG Implementation (Pinecone & Embeddings)

**Goal:** Process uploaded files, generate embeddings, store in Pinecone, and retrieve relevant chunks during chat.

- [x] **4.1 Setup Pinecone Client:**
  - Create `lib/pinecone-client.ts`: Initialize and export a configured `@pinecone-database/pinecone` client instance using environment variables
- [x] **4.2 Create Embedding Utility:**
  - Create/Update `lib/ai/utils.ts`: Add an async function `generateEmbeddings(text: string)` that uses the configured Gemini embedding model from `myProvider`
- [x] **4.3 Backend Processing Service:**
  - Create a new file/service (e.g., `lib/rag-processor.ts` or an API route like `app/api/process-file/route.ts`) triggered by the upload API (Phase 3.2)
  - Implement function `processFileForRag(fileMetadata)`:
    - Download file from `blobUrl`
    - Use libraries (e.g., `pdf-parse` for PDF, appropriate libs for DOCX) to extract text content
    - Implement text chunking logic
    - Update file `ragStatus` to 'processing' in DB
    - Loop through chunks:
      - Call `generateEmbeddings` (Step 4.2)
      - Use Pinecone client (Step 4.1) to `upsert` vector (embedding, chunk text, metadata like `fileId`, `userId`) to Pinecone index
    - Update file `ragStatus` to 'completed' or 'failed' in DB on finish/error
- [x] **4.4 Implement Retrieval Logic:**
  - In `app/(chat)/api/chat/route.ts`:
    - Before the main `streamText` call:
      - Call `generateEmbeddings` (Step 4.2) for the user's query
      - Use Pinecone client (Step 4.1) to `query` the index with the query vector, filtering by `userId`
      - Retrieve top K matching text chunks

## Phase 4 Progress Update
We've successfully implemented Phase 4 with the following components:
1. Created a Pinecone client for vector database integration
2. Implemented embedding generation using Google's embedding model
3. Built a robust document processing pipeline with:
   - Text extraction from PDF and TXT files
   - Intelligent text chunking with overlaps
   - Batch processing of vectors to avoid rate limits
   - Proper error handling and status updates
4. Enhanced the chat API to:
   - Retrieve relevant document context based on user queries
   - Incorporate the context into the model's prompt
   - Preserve fallback to general knowledge when no context is found

## Phase 5: RAG Context Integration & Testing

**Goal:** Feed retrieved context to the Gemini model and refine prompts for optimal behavior.

- [x] **5.1 Inject RAG Context:**
  - In `app/(chat)/api/chat/route.ts`: Format the retrieved Pinecone chunks from Step 4.4. Modify the `messages` array or `system` prompt passed to `streamText` to include this context, clearly labeling it for the model
- [x] **5.2 Create Test Document:**
  - Create `test-documents/rag-test-document.txt` with comprehensive information for testing the RAG pipeline
  - Include varied sections and specific facts that can be easily queried
- [x] **5.3 Develop Testing Script:**
  - Create `scripts/test-rag-pipeline.mjs` script to validate each step of the RAG pipeline:
    - Document upload and metadata storage
    - Processing, chunking, and embedding generation
    - Vector search with query embeddings
    - Retrieval of relevant chunks based on semantic similarity
- [x] **5.4 Add Source Attribution:**
  - Update RAG processor to include document name in vector metadata
  - Enhance chat route to display source information in the context
  - Add instructions in the system prompt for proper source citation
  - Ensure the AI model attributes information to the correct document source
- [x] **5.5 Test with Various Document Types:**
  - Upload and test diverse document types (PDF, TXT, DOCX)
  - Verify text extraction works correctly for all supported formats
  - Evaluate chunking effectiveness across different document structures

## Phase 6: Deployment & Final Testing

**Goal:** Deploy the application to Vercel and perform final checks.

- [x] **6.1 Configure Vercel Environment Variables:**
  - Ensure all keys (`GOOGLE_API_KEY`, `OPENAI_API_KEY`, `TAVILY_API_KEY`, `PINECONE_API_KEY`, `PINECONE_ENVIRONMENT`, `POSTGRES_URL`, `BLOB_READ_WRITE_TOKEN`, `AUTH_SECRET`) are set in the Vercel project settings
- [x] **6.2 Create a Pre-Deployment Checklist:**
  - Verify all environment variables are configured
  - Ensure database migrations are up to date
  - Validate that all API routes are working as expected
  - Test file uploads, RAG processing, and chat functionality
- [x] **6.3 Deploy to Vercel:**
  - Commit and push all changes to the Git repository linked to Vercel
  - Monitor the build logs for any errors or warnings
- [x] **6.4 Post-Deployment Validation:**
  - Test authentication and user sessions
  - Verify file uploads and processing
  - Test RAG context retrieval in conversations
  - Validate web search functionality
  - Monitor logging and error reporting

## Phase 7: Final Optimizations for v1.0 Release

**Goal:** Clean up the codebase, improve robustness, and prepare for v1.0 release.

- [x] **7.1 Code Cleanup:**
  - Remove deprecated functions and unused code
  - Improve error handling throughout the application
  - Standardize logging formats for better monitoring
- [x] **7.2 RAG Worker Improvements:**
  - Implement proper manual QStash signature verification
  - Add idempotency handling to prevent duplicate processing
  - Fix body reading issues with proper streaming
- [x] **7.3 Attachment Content Type Fixes:**
  - Enhance experimental_attachments content type detection
  - Add multiple methods to extract document IDs
  - Fetch content types directly from document records in the database
  - Support a wider range of file formats
- [x] **7.4 Documentation Updates:**
  - Update README.md with latest features and configuration options
  - Update DEVELOPMENT_CHECKLIST.md to mark all items complete
  - Update README_PROGRESS.md to reflect v1.0 status
- [x] **7.5 Final Testing:**
  - Verify all features work together seamlessly
  - Test with real-world documents and queries
  - Check error handling and failure recovery
  - Ensure all environment variables are correctly documented

## Phase 8: Post-v1.0 Bug Fixes - v1.1 Release

**Goal:** Address critical bugs discovered after the v1.0 release and improve system stability.

- [x] **8.1 UUID Validation Fix:**
  - Fix UUID validation in `enhanceAttachmentsWithMetadata` function to prevent "invalid input syntax for type uuid" database errors
  - Add proper validation checks before attempting database queries
  - Skip invalid database queries when document ID is not a valid UUID
- [x] **8.2 Document ID Extraction Improvement:**
  - Add explicit checking for document ID properties on attachment objects
  - Improve extraction of document IDs from attachment URLs and names
  - Remove problematic extraction methods that produced invalid IDs
- [x] **8.3 Error Handling Enhancement:**
  - Add better fallback mechanisms when document metadata cannot be retrieved
  - Implement more robust validation checks throughout attachment processing
  - Ensure graceful degradation when encountering attachment-related issues
- [x] **8.4 Logging Improvements:**
  - Add more detailed diagnostic logging for attachment processing
  - Include validation status in logs to aid troubleshooting
  - Log specific reasons why document IDs might be rejected
- [x] **8.5 Documentation Updates:**
  - Update README.md to note the v1.1 release
  - Document the UUID validation improvements in README_PROGRESS.md
  - Add Phase 8 to DEVELOPMENT_CHECKLIST.md
  - Create v1.1 tag and release notes 