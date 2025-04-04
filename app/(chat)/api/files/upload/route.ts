import { NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import { put } from '@vercel/blob';
import { saveDocument, updateFileRagStatus } from '@/lib/db/queries';
import { Client } from "@upstash/qstash";
import { randomUUID } from 'crypto';

// Initialize QStash client
const qstashClient = new Client({
  token: process.env.QSTASH_TOKEN!
});

// Helper function to ensure complete URL
function ensureCompleteUrl(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`;
  }
  return url;
}

// Supported document types for RAG processing
const documentTypes = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // Add support for image formats
  'image/jpeg',
  'image/jpg',
  'image/tiff',
  'image/png',
  // Add support for JSON files
  'application/json',
  // Add support for Google formats
  'application/vnd.google-apps.presentation',
  // Add support for generic binary files - we'll check file extension
  'application/octet-stream'
];

// Document kind for database
const ArtifactKind = {
  Text: 'text',
  Code: 'code',
  Image: 'image',
  Sheet: 'sheet'
} as const;

// Configure request size limits for file uploads - using the new format for App Router
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const fetchCache = 'force-no-store';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    // Verify authentication
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    const userId = session.user.id;

    // Get the file from the request
    const form = await request.formData();
    const file = form.get('file') as File;
    
    // Get the folderPath from the form data, if provided
    const folderPath = form.get('folderPath') as string | null;
    
    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Log file details to help with debugging
    console.log(`[Upload API] Processing file: ${file.name}, Size: ${(file.size / (1024 * 1024)).toFixed(2)}MB, Type: ${file.type}, FolderPath: ${folderPath || 'root'}`);
    
    // Enhanced debugging for DOCX files
    if (file.name.toLowerCase().endsWith('.docx')) {
      console.log(`[Upload API] DOCX file detected: ${file.name}`);
      console.log(`[Upload API] File MIME type from browser: ${file.type}`);
      
      const expectedMimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      
      if (file.type !== expectedMimeType) {
        console.warn(`[Upload API] WARNING: Browser reported incorrect MIME type for DOCX file!`);
        console.warn(`[Upload API] Expected: ${expectedMimeType}, Got: ${file.type}`);
        console.log(`[Upload API] Will use file extension to determine processing method instead of MIME type`);
      }
      
      // Check if this file type is in our supported types
      console.log(`[Upload API] Is this MIME type in supported types?: ${documentTypes.includes(file.type)}`);
      console.log(`[Upload API] Is the expected MIME type in supported types?: ${documentTypes.includes(expectedMimeType)}`);
    }
    
    // Check file size limits - 20MB max
    const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB in bytes
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB` },
        { status: 413 }
      );
    }

    // Upload file to blob storage
    const { url } = await put(file.name, file, {
      access: 'public',
    });

    // Generate document ID
    const documentId = randomUUID();

    // Save document metadata to database
    await saveDocument({
      id: documentId,
      userId: userId,
      blobUrl: url,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      processingStatus: 'pending',
      folderPath: folderPath || undefined // Pass folderPath to saveDocument
    });

    console.log(`[Upload API] Document ${documentId} saved to database. Folder path: ${folderPath || 'none'}`);

    // Get file extension
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    
    // Determine if document type is supported by either MIME type or file extension
    const isSupportedByMimeType = documentTypes.includes(file.type);
    const isSupportedByExtension = fileExtension === 'docx' || 
                                  fileExtension === 'pdf' || 
                                  fileExtension === 'txt' || 
                                  fileExtension === 'md' || 
                                  fileExtension === 'csv' || 
                                  fileExtension === 'xlsx' ||
                                  // Add support for additional file extensions
                                  fileExtension === 'json' ||
                                  fileExtension === 'jpg' ||
                                  fileExtension === 'jpeg' ||
                                  fileExtension === 'tiff' ||
                                  fileExtension === 'png' ||
                                  fileExtension === 'gslides';
    
    // Special handling for octet-stream files - we need to check the extension
    const isOctetStreamWithSupportedExtension = file.type === 'application/octet-stream' && isSupportedByExtension;
    
    // If document type is supported, enqueue RAG processing
    if (isSupportedByMimeType || isSupportedByExtension || isOctetStreamWithSupportedExtension) {
      console.log(`[Upload API] Document supported for RAG processing: MIME type check: ${isSupportedByMimeType}, Extension check: ${isSupportedByExtension}, Octet-stream special check: ${isOctetStreamWithSupportedExtension}`);
    
      const rawWorkerUrl = process.env.QSTASH_WORKER_URL;

      // Log the raw URL being used
      console.log(`[Upload API] Raw Worker URL from env: ${rawWorkerUrl || 'Not Set!'}`);

      if (!rawWorkerUrl) {
        console.error("[Upload API] QSTASH_WORKER_URL environment variable is not set! Cannot enqueue job.");
        // Update status to failed immediately if URL is missing
        await updateFileRagStatus({
          id: documentId,
          processingStatus: 'failed',
          statusMessage: 'Server config error: Worker URL missing.'
        });
        // Return a response indicating the queueing failed due to config
        return NextResponse.json({
          documentId,
          url,
          warning: 'File uploaded but processing cannot be queued (config error).'
        });
      }

      // Ensure complete URL with protocol
      const workerUrl = ensureCompleteUrl(rawWorkerUrl);
      console.log(`[Upload API] Complete Worker URL: ${workerUrl}`);

      // Log QStash token presence (not the actual token for security)
      const qstashToken = process.env.QSTASH_TOKEN;
      console.log(`[Upload API] QStash token present?: ${!!qstashToken}`);
      if (!qstashToken) {
        console.error("[Upload API] QSTASH_TOKEN is missing! Cannot authenticate with QStash.");
        await updateFileRagStatus({
          id: documentId,
          processingStatus: 'failed',
          statusMessage: 'Server config error: QStash token missing.'
        });
        return NextResponse.json({
          documentId,
          url,
          warning: 'File uploaded but processing cannot be queued (auth config error).'
        });
      }

      // Prepare job payload
      const jobPayload = {
        documentId,
        userId,
        fileExtension,
      };
      console.log(`[Upload API] Prepared job payload:`, JSON.stringify(jobPayload));

      console.log(`[Upload API] Enqueuing RAG job for document ${documentId} to worker URL: ${workerUrl}`);
      try {
        // Log QStash client configuration before publishing
        console.log('[Upload API] Using QStash client with configuration:', {
          hasToken: !!process.env.QSTASH_TOKEN,
        });

        // Await the publish call and capture the result
        console.time('[Upload API] qstash_publish_call');
        const publishResult = await qstashClient.publishJSON({
          url: workerUrl,
          body: jobPayload,
          retries: 3,
        });
        console.timeEnd('[Upload API] qstash_publish_call');

        // Log the raw result object from QStash publish
        console.log(`[Upload API] QStash publish result object:`, JSON.stringify(publishResult || {}));

        // Check specifically for messageId, which indicates successful reception by QStash API
        if (publishResult?.messageId) {
          console.log(`[Upload API] Successfully enqueued RAG job for ${documentId}. QStash Message ID: ${publishResult.messageId}`);
          
          // Update status to show queued with messageId
          await updateFileRagStatus({
            id: documentId,
            processingStatus: 'pending',
            statusMessage: `Queued for processing (${publishResult.messageId})`
          });
        } else {
          console.warn(`[Upload API] ⚠️ Enqueued RAG job for ${documentId}, but did NOT receive messageId in response. Job might not be processed by QStash.`);
          // Update status to failed if messageId is missing
          await updateFileRagStatus({
            id: documentId,
            processingStatus: 'failed',
            statusMessage: 'Failed to confirm queueing with QStash (no messageId received).'
          });
          return NextResponse.json({
            documentId,
            url,
            warning: 'File uploaded but failed to confirm processing queue status.'
          });
        }

      } catch (queueError) {
        console.error(`[Upload API] ------------------------------------------------------`);
        console.error(`[Upload API] FAILED to enqueue RAG job for ${documentId}:`, queueError);
        // Log the full error object structure if possible
        if (queueError instanceof Error) {
          console.error(`[Upload API] Queue Error Name: ${queueError.name}`);
          console.error(`[Upload API] Queue Error Message: ${queueError.message}`);
          console.error(`[Upload API] Queue Error Stack: ${queueError.stack}`);
          
          // Check for network errors specifically
          if (queueError.name === 'FetchError' || queueError.message.includes('network') || queueError.message.includes('ENOTFOUND')) {
            console.error('[Upload API] This appears to be a network connectivity issue reaching the QStash API');
          }
          // Check for auth errors
          else if (queueError.message.includes('unauthorized') || queueError.message.includes('forbidden') || queueError.message.includes('401') || queueError.message.includes('403')) {
            console.error('[Upload API] This appears to be an authentication/authorization issue with QStash');
            console.error('[Upload API] Please verify your QSTASH_TOKEN is correct and not expired');
          }
        } else {
          console.error(`[Upload API] Queue Error (raw):`, queueError);
        }
        console.error(`[Upload API] ------------------------------------------------------`);

        // Update document status to failed with specific error type hints
        let errorMessage = 'Failed to queue processing job';
        if (queueError instanceof Error) {
          if (queueError.name === 'FetchError' || queueError.message.includes('network')) {
            errorMessage += ': Network error connecting to QStash';
          } else if (queueError.message.includes('unauthorized') || queueError.message.includes('forbidden')) {
            errorMessage += ': Authentication failed with QStash';
          } else {
            errorMessage += `: ${queueError.message}`;
          }
        } else {
          errorMessage += `: ${String(queueError)}`;
        }
        
        await updateFileRagStatus({
          id: documentId,
          processingStatus: 'failed',
          statusMessage: errorMessage
        });

        // Return warning in the response
        return NextResponse.json({
          documentId,
          url,
          warning: 'File uploaded but processing queue failed',
          error: errorMessage
        });
      }
    }

    // Return success response
    return NextResponse.json({
      documentId,
      url,
      fileName: file.name,
      contentType: file.type,
      fileSize: file.size
    });

  } catch (error) {
    console.error('[Upload API] Error:', error);
    if (error instanceof Error) {
      console.error('[Upload API] Error name:', error.name);
      console.error('[Upload API] Error message:', error.message);
      console.error('[Upload API] Error stack:', error.stack);
    }
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}