import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
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
    const userId = session.userId;
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

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
      console.log(`[Upload API] Enqueuing RAG processing for document ${documentId}`);
      
      try {
        await qstashClient.publishJSON({
          url: new URL('/api/rag-worker', request.url).toString(),
          body: {
            documentId,
            userId,
          },
          // Optional: Configure retries
          retries: 3,
        });
        
        console.log(`[Upload API] Successfully enqueued RAG job for ${documentId}`);
        
      } catch (queueError) {
        console.error(`[Upload API] Failed to enqueue RAG job for ${documentId}:`, queueError);
        
        // Update document status to failed
        await updateFileRagStatus({
          id: documentId,
          processingStatus: 'failed',
          statusMessage: 'Failed to queue processing job'
        });
        
        // Don't fail the upload response, just return success with warning
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