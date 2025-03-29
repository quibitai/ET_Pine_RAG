# ET Pine RAG - Advanced Next.js RAG Chatbot

A Retrieval Augmented Generation (RAG) powered chatbot built with Next.js, Google AI SDK, Pinecone, and Vercel Blob storage.

## Features

- PDF, TXT, and DOCX document upload and processing
- Vector storage with Pinecone
- LLM-powered chat with document context retrieval
- Authentication with Next Auth
- File storage with Vercel Blob
- Embedding generation with Replicate's Llama-text-embed-v2

## Tech Stack

- Next.js 15
- TypeScript
- Google AI SDK
- Pinecone Vector Database
- Vercel Blob Storage
- Drizzle ORM
- PostgreSQL
- Replicate API (Llama-text-embed-v2)

## Deployment to Vercel

### Prerequisites

Before deploying this application, you'll need:

1. A Vercel account
2. A Pinecone database account
3. A Replicate account for embeddings
4. A Google API key for AI
5. A Tavily API key for web search (optional)

### Environment Variables

When deploying to Vercel, you need to set up the following environment variables:

```
# API Keys
GOOGLE_API_KEY=your_google_api_key_here
GOOGLE_GENERATIVE_AI_API_KEY=your_google_api_key_here
PINECONE_API_KEY=your_pinecone_api_key_here
TAVILY_API_KEY=your_tavily_api_key_here (optional)
OPENAI_API_KEY=your_openai_api_key_here (optional)
REPLICATE_API_TOKEN=your_replicate_api_token_here

# Pinecone Configuration
PINECONE_ENVIRONMENT=your_pinecone_environment (classic Pinecone)
PINECONE_INDEX_HOST=your_pinecone_host_url (serverless Pinecone)
PINECONE_INDEX_NAME=your_index_name

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

5. **Add Additional Environment Variables**
   - Add all required environment variables listed above to your Vercel project
   - Go to Settings → Environment Variables in your Vercel project dashboard

6. **Deploy Your Project**
   - Click Deploy in the Vercel dashboard
   - The build and database migrations will run automatically

7. **Verify Your Deployment**
   - Test document uploads, RAG processing, and chat functionality
   - Check logs for any issues

## Local Development

1. Clone the repository
2. Create a `.env.local` file with the variables from `.env.example`
3. Run `pnpm install` to install dependencies
4. Run `pnpm db:migrate` to set up the database
5. Run `pnpm dev` to start the development server

## Troubleshooting

- **Blob Storage Issues**: Ensure your `BLOB_READ_WRITE_TOKEN` is valid and has the correct permissions
- **Database Connection**: Verify your Postgres connection string is correct
- **Pinecone Configuration**: Make sure you've provided either `PINECONE_ENVIRONMENT` or `PINECONE_INDEX_HOST`
- **RAG Processing**: Check logs for errors in document processing or embedding generation
