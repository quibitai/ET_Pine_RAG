# ET Pine RAG - Advanced Next.js RAG Chatbot

A Retrieval Augmented Generation (RAG) powered chatbot built with Next.js, Google AI SDK, Pinecone, and Vercel Blob storage.

## Latest Release - v1.5.0

* Enhanced chat API to intelligently handle generic queries after file uploads
* Improved DOCX file handling by checking file extension in addition to MIME type
* Extended file upload support for all document formats
* Fixed user authentication by restoring password field in User schema
* Corrected RAG worker import path for generateEmbeddings
* Updated file upload dialog to show all supported file formats

[View all releases](https://github.com/quibitai/ET_Pine_RAG/releases)

## Features

- **Document upload and processing** for PDF, DOCX, TXT, CSV, XLSX, and Markdown files
- **Intelligent document handling** with automatic format detection
- **Smart conversation context** that understands when queries refer to uploaded documents
- **Vector storage with Pinecone** for semantic search
- **LLM-powered chat** with document context retrieval and source attribution
- **Multiple AI models** including Google Gemini and OpenAI
- **Real-time web search** with Tavily integration
- **Authentication** with Next Auth
- **File storage** with Vercel Blob
- **Background processing** with QStash
- **Robust error handling** and logging

## Tech Stack

- **Next.js 15** with App Router
- **TypeScript** for type safety
- **Google AI SDK** for Gemini models
- **OpenAI SDK** for GPT models
- **Google Document AI** for document text extraction
- **Pinecone Vector Database** for semantic search
- **Vercel Blob Storage** for file uploads
- **QStash** for background processing
- **Drizzle ORM** with PostgreSQL
- **OpenAI Embeddings** for vector representations

## Deployment to Vercel

### Prerequisites

Before deploying this application, you'll need:

1. A Vercel account
2. A Pinecone database account
3. A Google Cloud account with Document AI set up
4. A QStash account for background processing
5. A Google AI API key for Gemini models
6. A Replicate account for embeddings
7. A Tavily API key for web search (optional)
8. An OpenAI API key for GPT models (optional)

### Environment Variables

When deploying to Vercel, you need to set up the following environment variables:

```
# API Keys
GOOGLE_API_KEY=your_google_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
GOOGLE_CREDENTIALS_JSON=your_service_account_json
GOOGLE_PROJECT_ID=your_google_project_id
DOCUMENT_AI_PROCESSOR_ID=your_document_ai_processor_id
DOCUMENT_AI_LOCATION=your_document_ai_location
PINECONE_API_KEY=your_pinecone_api_key_here
TAVILY_API_KEY=your_tavily_api_key_here (optional)

# QStash for background processing
QSTASH_CURRENT_SIGNING_KEY=your_qstash_current_signing_key
QSTASH_NEXT_SIGNING_KEY=your_qstash_next_signing_key
QSTASH_TOKEN=your_qstash_token
QSTASH_WORKER_URL=your_app_url/api/rag-worker

# Pinecone Configuration
PINECONE_INDEX_NAME=your_index_name
PINECONE_ENVIRONMENT=your_pinecone_environment (classic Pinecone)
PINECONE_INDEX_HOST=your_pinecone_host_url (serverless Pinecone)

# Database (Will be configured by Vercel Postgres)
POSTGRES_URL=your_postgres_connection_string

# Authentication
AUTH_SECRET=random_secret_string_for_next_auth
```

### Deployment Steps

1. **Fork or Clone Repository**
   - Fork this repository to your GitHub account or clone it directly

2. **Create a New Vercel Project**
   - Go to [Vercel](https://vercel.com/) and create a new project
   - Import your GitHub repository

3. **Set Up Vercel Postgres**
   - In your Vercel project dashboard, go to Storage → Create New → Postgres Database
   - Vercel will automatically add the required environment variables

4. **Configure Vercel Blob Storage**
   - In your Vercel project dashboard, go to Storage → Create New → Blob Storage
   - Vercel will automatically add the required environment variables
   - Alternatively, run `npx vercel blob generate` to create a new blob store

5. **Set Up QStash**
   - Sign up for QStash at [Upstash](https://upstash.com/)
   - Create a new QStash project
   - Add your signing keys to environment variables

6. **Set Up Google Document AI**
   - Create a processor in Google Cloud Console
   - Create a service account and download the credentials JSON
   - Add the processor ID, location, and credentials to environment variables

7. **Add All Environment Variables**
   - Add all required environment variables listed above to your Vercel project
   - Go to Settings → Environment Variables in your Vercel project dashboard

8. **Deploy Your Project**
   - Click Deploy in the Vercel dashboard
   - The build and database migrations will run automatically

9. **Verify Your Deployment**
   - Test document uploads, RAG processing, and chat functionality
   - Check logs for any issues

## Local Development

1. Clone the repository
2. Create a `.env.local` file with the variables from `.env.example`
3. Run `pnpm install` to install dependencies
4. Run `pnpm db:migrate` to set up the database
5. Run `pnpm dev` to start the development server

## Features in Detail

### Document Processing

The application uses Google Document AI for text extraction from various document formats. The processing pipeline:

1. Uploads files to Vercel Blob storage
2. Processes them with Google Document AI in the background using QStash
3. Handles multiple document formats including PDF, DOCX, TXT, CSV, XLSX, and Markdown
4. Chunks the extracted text and generates embeddings using OpenAI's text-embedding-3-large model
5. Stores the vectors in Pinecone for semantic search

### Conversational AI

The chat interface supports:

1. Multiple AI models (Google Gemini and OpenAI GPT)
2. Real-time web search via Tavily
3. Document context retrieval from your uploaded files
4. Smart handling of generic queries about uploaded documents
5. Source attribution for information from documents
6. File attachments with proper content type handling

### Background Processing

Document processing is handled in the background:

1. QStash queues processing tasks
2. The worker processes documents with proper error handling
3. Idempotency checks prevent duplicate processing
4. Status tracking shows processing progress

## Troubleshooting

- **Blob Storage Issues**: Ensure your `BLOB_READ_WRITE_TOKEN` is valid and has the correct permissions
- **Database Connection**: Verify your Postgres connection string is correct
- **Pinecone Configuration**: Make sure you've provided either `PINECONE_ENVIRONMENT` or `PINECONE_INDEX_HOST`
- **QStash Errors**: Check that your signing keys are correctly configured
- **DOCX Handling Issues**: If DOCX files aren't processing correctly, check browser logs for MIME type errors
- **Document AI**: Verify your service account has the Document AI API User role and processor ID is correct
- **Embedding Generation**: Confirm your OpenAI API key is valid and has enough quota
- **RAG Processing**: Monitor logs for errors in document processing or embedding generation
- **Attachment Content Types**: If attachments aren't displaying correctly, check the logs for content type detection

## License

This project is licensed under the MIT License - see the LICENSE file for details.
