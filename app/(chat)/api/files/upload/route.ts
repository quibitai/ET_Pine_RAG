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
      const workerUrl = process.env.QSTASH_WORKER_URL;

      // Log the URL being used BEFORE attempting to publish
      console.log(`[Upload API] Worker URL from env: ${workerUrl || 'Not Set!'}`);

      if (!workerUrl) {
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

      console.log(`[Upload API] Enqueuing RAG job for document ${documentId} to worker URL: ${workerUrl}`);
      try {
        // Await the publish call and capture the result
        const publishResult = await qstashClient.publishJSON({
          url: workerUrl, // Use the verified absolute URL
          body: {
            documentId,
            userId,
          },
          retries: 3, // Keep retries configured
        });

        // Log the raw result object from QStash publish
        console.log(`[Upload API] QStash publish result object:`, JSON.stringify(publishResult || {}));

        // Check specifically for messageId, which indicates successful reception by QStash API
        if (publishResult?.messageId) {
          console.log(`[Upload API] Successfully enqueued RAG job for ${documentId}. QStash Message ID: ${publishResult.messageId}`);
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
        } else {
          console.error(`[Upload API] Queue Error (raw):`, queueError);
        }
        console.error(`[Upload API] ------------------------------------------------------`);

        // Update document status to failed
        await updateFileRagStatus({
          id: documentId,
          processingStatus: 'failed',
          statusMessage: `Failed to queue processing job: ${queueError instanceof Error ? queueError.message : String(queueError)}`
        });

        // Return warning in the response
        return NextResponse.json({
          documentId,
          url,
          warning: 'File uploaded but processing queue failed'
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
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}