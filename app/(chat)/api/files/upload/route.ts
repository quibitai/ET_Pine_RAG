import { auth } from '@/app/(auth)/auth';
import { saveDocument } from '@/lib/db/queries';
import { put } from '@vercel/blob';
import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';

// Runtime declaration for Vercel
export const runtime = 'nodejs';

// Define ArtifactKind locally if it's not available from components
const ArtifactKind = {
  Text: 'text',
  Code: 'code',
  Image: 'image',
  Sheet: 'sheet'
} as const;

// File validation schema
const FileSchema = z.instanceof(Blob)
  .refine(
    (file) => file.size <= 10 * 1024 * 1024,
    {
      message: 'File size must be less than 10MB',
    }
  )
  .refine(
    (file) => {
      const acceptableTypes = [
        'image/jpeg',
        'image/png',
        'application/pdf',
        'text/plain',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ];
      return acceptableTypes.includes(file.type);
    },
    {
      message: 'File type must be one of: JPEG, PNG, PDF, TXT, DOCX',
    }
  );

// Function to trigger RAG processing for document
const createRagDocument = async (documentId: string, fileUrl: string, fileType: string, userId: string) => {
  console.log(`Starting RAG document processing for document ID: ${documentId}`);
  
  try {
    // Import dynamically to avoid circular dependencies
    const { processFileForRag } = await import('@/lib/rag-processor');
    
    // Process the file for RAG asynchronously
    console.log(`[ASYNC] Triggering background RAG processing for document ${documentId}`);
    processFileForRag({
      documentId,
      fileUrl,
      fileType,
      userId,
    }).catch((error) => {
      console.error(`[ASYNC] Background RAG processing error:`, error);
      // Error will be handled within processFileForRag by updating the document status
    });
    
    console.log(`[ASYNC] Background RAG processing initiated for document ${documentId}`);
    return true;
  } catch (error) {
    console.error(`Error starting RAG processing: ${error}`);
    return false;
  }
};

export async function POST(request: Request) {
  console.log('Upload API route started.');
  try {
    // Check authentication
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.log(`User authenticated: ${session.user.id}`);

    // Parse form data
    console.log('Attempting to parse FormData...');
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      console.log('No file found in request');
      return NextResponse.json({ error: 'No file found' }, { status: 400 });
    }

    const filename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    console.log(`FormData parsed. File name: ${filename} File type: ${file.type} File size: ${file.size}`);

    // Validate file using Zod
    console.log('Validating file with Zod...');
    const validatedFile = FileSchema.safeParse(file);
    console.log('Zod validation result:', validatedFile.success ? 'success' : validatedFile.error.errors);

    if (!validatedFile.success) {
      const errorMessage = validatedFile.error.errors
        .map((error) => error.message)
        .join(', ');
      console.log('File validation failed:', errorMessage);
      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    const fileBuffer = await file.arrayBuffer();
    console.log('File buffer prepared. Size:', fileBuffer.byteLength);

    try {
      console.log(`Uploading file to Vercel Blob...`);
      
      // Log environment variables (without revealing full tokens)
      const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
      console.log(`BLOB_READ_WRITE_TOKEN present: ${!!blobToken}`);
      if (!blobToken) {
        throw new Error('BLOB_READ_WRITE_TOKEN environment variable is missing');
      }
      
      // Generate a unique file path to avoid name collisions
      const uniqueFilename = `${Date.now()}-${filename}`;
      
      // Upload directly to Vercel Blob with enhanced error handling
      let data;
      try {
        data = await put(uniqueFilename, Buffer.from(fileBuffer), {
          contentType: file.type,
          access: 'public',
        });
        console.log('File upload successful:', data.url);
      } catch (blobError: any) {
        console.error('Vercel Blob specific error:', blobError);
        console.error('Error details:', blobError.message);
        console.error('Error name:', blobError.name);
        if (blobError.response) {
          console.error('Error response:', blobError.response.status, blobError.response.statusText);
        }
        return NextResponse.json({ 
          error: 'Failed to upload file to storage', 
          details: blobError.message
        }, { status: 500 });
      }
      
      // Save the document reference in the database
      const documentId = randomUUID();
      const userId = session.user.id;
      
      // Ensure userId is a string
      if (!userId) {
        return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
      }
      
      await saveDocument({
        id: documentId,
        title: filename,
        fileUrl: data.url,
        fileName: filename,
        fileType: file.type,
        fileSize: file.size.toString(),
        userId,
        kind: ArtifactKind.Text,
        processingStatus: 'pending',
      });
      console.log('Document entry created in database with ID:', documentId);
      
      // If the file type is a document that can be processed for RAG, trigger processing
      const documentTypes = [
        'application/pdf',
        'text/plain',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ];
      
      if (documentTypes.includes(file.type)) {
        console.log('Document type is eligible for RAG processing. Initiating background processing...');
        try {
          // Run asynchronously without await
          createRagDocument(documentId, data.url, file.type, userId);
          console.log('Background RAG processing triggered successfully.');
        } catch (error) {
          console.error('Error triggering background RAG processing:', error);
          // Still don't fail the request - RAG processing is secondary to file upload
        }
      } else {
        console.log('Document type not eligible for RAG processing');
      }
      
      // Return success with the document ID
      return NextResponse.json({ 
        id: documentId,
        url: data.url,
        name: filename,
        pathname: filename,
        contentType: file.type
      });
    } catch (error: any) {
      console.error('Error uploading file:', error);
      console.error('Error stack:', error.stack);
      return NextResponse.json({ 
        error: 'Failed to upload file', 
        details: error instanceof Error ? error.message : String(error) 
      }, { status: 500 });
    }
  } catch (error: any) {
    console.error('Unhandled error in upload API route:', error);
    console.error('Error stack:', error.stack);
    return NextResponse.json({ 
      error: 'Internal server error', 
      details: error instanceof Error ? error.message : String(error) 
    }, { status: 500 });
  }
}