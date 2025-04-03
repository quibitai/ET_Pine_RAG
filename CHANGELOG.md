# Changelog

All notable changes to the ET Pine RAG project will be documented in this file.

## [1.1.0] - 2024-06-12

### Fixed
- UUID validation in `enhanceAttachmentsWithMetadata` function to prevent "invalid input syntax for type uuid" database errors
- Improved document ID extraction from attachment URLs and names
- Added proper validation before attempting database queries
- Skip invalid database queries when document ID is not a valid UUID format

### Added
- Explicit checking for document ID properties on attachment objects
- More detailed diagnostic logging for attachment processing
- Validation status in logs to aid troubleshooting

### Changed
- Removed problematic extraction methods that produced invalid IDs
- Enhanced fallback mechanisms when document metadata cannot be retrieved
- Improved documentation with v1.1 release notes

## [1.0.0] - 2024-06-11

### Added
- RAG implementation with Pinecone vector database
- PDF, TXT, and DOCX document upload and processing
- Google Document AI integration for text extraction
- QStash for background processing
- Vercel Blob storage for files
- Multiple AI model support (Google Gemini and OpenAI)
- Real-time web search via Tavily
- Source attribution for document citations
- Proper idempotency handling for RAG processing

### Changed
- Enhanced attachment content type detection
- Improved error handling throughout the application
- Updated system prompts for better source attribution

### Fixed
- QStash signature verification issues
- Body reading problems with proper streaming
- Error handling in RAG worker 