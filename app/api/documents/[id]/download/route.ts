import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import { getDocumentDetails } from '@/lib/services/document-service';
import { getDocumentById } from '@/lib/db/queries';
import { del, list } from '@vercel/blob';

// Ensure this API route is always dynamically rendered
export const dynamic = 'force-dynamic';

/**
 * GET /api/documents/[id]/download
 * Download a document
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Authenticate the user
    const session = await auth();
    const user = session?.user;

    if (!user || !user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = params;
    console.info(`Processing document download request for document ${id}`);
    
    // Get document details from database
    const document = await getDocumentDetails(id);
    
    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }
    
    // Check document ownership
    if (document.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized access to document' }, { status: 403 });
    }

    // Initialize variables for content handling
    let fileData: Buffer | null = null;
    let contentType = document.fileType || 'application/octet-stream';
    
    // Try to get the file from Vercel Blob storage first
    if (document.blobUrl && document.blobUrl.trim() !== '') {
      try {
        console.log(`Retrieving blob from URL: ${document.blobUrl}`);
        
        // Use standard fetch to get the blob content directly
        const response = await fetch(document.blobUrl);
        
        if (response.ok) {
          console.log(`Successfully retrieved blob for document ${id}`);
          // Convert the response to an array buffer and then to Buffer
          const arrayBuffer = await response.arrayBuffer();
          fileData = Buffer.from(arrayBuffer);
          contentType = response.headers.get('Content-Type') || contentType;
        }
      } catch (blobError) {
        console.error(`Error retrieving blob for document ${id}:`, blobError);
        // Continue to try other methods if blob retrieval fails
      }
    }

    // If no file data from blob, check if this is an artifact document in the system
    if (!fileData && (document.fileType?.includes('text/') || 
                      document.fileType?.includes('application/json') || 
                      document.fileType?.includes('code'))) {
      // For text-based documents created as artifacts, return the content as text
      // Create a basic version of the file based on the document type
      const artifactContent = `${document.fileName}\n\nThis document was created in the knowledge base.\n`;
      fileData = Buffer.from(artifactContent);
    }

    // If we have file data, return it as a download
    if (fileData) {
      // Determine suitable filename
      const filename = document.fileName || `document-${id}.txt`;
      
      // Create response with appropriate headers for download
      return new Response(fileData, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
          'Content-Length': String(fileData.byteLength),
        },
      });
    }

    // If we get here, we couldn't retrieve the document content
    return NextResponse.json({ 
      error: 'Document content not available',
      message: 'The document exists but its content could not be retrieved'
    }, { status: 404 });
    
  } catch (error) {
    console.error('Error downloading document:', error);
    return NextResponse.json(
      { error: 'Failed to download document' },
      { status: 500 }
    );
  }
} 