# Changelog

All notable changes to the ET Pine RAG project will be documented in this file.

## [1.9.0] - 2024-06-21

### Changed
- Removed default landing page text to create a cleaner interface
- Removed "Deploy with Vercel" button from the header
- Improved UI for a more professional appearance

## [1.8.1] - 2024-06-21

### Fixed
- Added automatic fallback to imageless mode for PDFs exceeding 15 pages
- Improved error handling in Document AI processing

## [1.8.0] - 2024-06-21

### Added
- New "EchoTango Bit" assistant persona using GPT-4o Mini model
- Custom system prompt for the EchoTango Bit persona focused on brand voice and storytelling

### Changed
- Replaced Gemini 2.5 Pro Exp model with EchoTango Bit
- Updated all model-related infrastructure to support multiple personas with the same base model
- Standardized on OpenAI models for all AI functions
- Set EchoTango Bit as the default assistant persona upon sign-in

## [1.7.0] - 2024-06-20

### Added
- Support for image files (JPEG, PNG, TIFF) in the RAG processing pipeline
- JSON file support with specialized processing for structured data
- Google Slides support with appropriate metadata handling
- Batch deletion functionality for documents in Knowledge Base
- Document details modal with comprehensive file information
- Collapsible chat history sections for better organization

### Improved
- Enhanced error handling in RAG worker to prevent files from getting stuck
- Added timeout handling for Document AI extraction process
- Improved handling of application/octet-stream files with known extensions
- Made sidebar open by default for better UX
- Back button in Knowledge Base for easier navigation

### Fixed
- Icon implementation in sidebar components
- Proper metadata extraction for various file types
- Sidebar history section to properly refresh with navigation changes

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