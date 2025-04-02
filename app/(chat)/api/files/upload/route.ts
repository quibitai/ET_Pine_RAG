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
  'text/markdown'
];

// Document kind for database
const ArtifactKind = {
  Text: 'text',
  Code: 'code',
  Image: 'image',
  Sheet: 'sheet'
} as const;

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
    
    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
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
      title: file.name,
      kind: ArtifactKind.Text,
      userId: userId,
      fileUrl: url,
      fileName: file.name,
      fileSize: file.size.toString(),
      fileType: file.type,
      processingStatus: 'pending'
    });

    console.log(`[Upload API] Document ${documentId} saved to database`);

    // If document type is supported, enqueue RAG processing
    if (documentTypes.includes(file.type)) {
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
      url
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