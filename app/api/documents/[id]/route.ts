import { NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import { 
  getDocumentDetails, 
  deleteDocument, 
  retryDocumentProcessing,
  getDocumentProgress
} from '@/lib/services/document-service';

/**
 * GET /api/documents/[id]
 * Retrieve a document by ID
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const documentId = params.id;
  
  try {
    // Authenticate user
    const session = await auth();
    const userId = session?.user?.id;
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Get document details
    const document = await getDocumentDetails(documentId);
    
    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }
    
    // Check if user owns document
    if (document.userId !== userId) {
      return NextResponse.json({ error: 'Unauthorized access to document' }, { status: 403 });
    }
    
    // Get detailed progress information
    const documentWithProgress = await getDocumentProgress(documentId);
    
    return NextResponse.json(documentWithProgress);
  } catch (error) {
    console.error(`Error retrieving document ${documentId}:`, error);
    return NextResponse.json(
      { error: 'Failed to retrieve document', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/documents/[id]
 * Delete a document and its associated data
 */
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const documentId = params.id;
  
  try {
    // Authenticate user
    const session = await auth();
    const userId = session?.user?.id;
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Delete document
    await deleteDocument(documentId, userId);
    
    return NextResponse.json({ success: true, message: 'Document deleted successfully' });
  } catch (error) {
    console.error(`Error deleting document ${documentId}:`, error);
    
    if (error instanceof Error && 
       (error.message.includes('not found') || error.message.includes('Document not found'))) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }
    
    if (error instanceof Error && error.message.includes('Unauthorized access')) {
      return NextResponse.json({ error: 'Unauthorized access to document' }, { status: 403 });
    }
    
    return NextResponse.json(
      { error: 'Failed to delete document', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/documents/[id]
 * Retry processing a failed document
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const documentId = params.id;
  
  try {
    // Get request body
    const body = await request.json();
    const { action } = body;
    
    // Authenticate user
    const session = await auth();
    const userId = session?.user?.id;
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Handle different actions
    if (action === 'retry') {
      await retryDocumentProcessing(documentId, userId);
      return NextResponse.json({ success: true, message: 'Document processing requeued' });
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error(`Error processing document action for ${documentId}:`, error);
    
    if (error instanceof Error && 
       (error.message.includes('not found') || error.message.includes('Document not found'))) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }
    
    if (error instanceof Error && error.message.includes('Unauthorized access')) {
      return NextResponse.json({ error: 'Unauthorized access to document' }, { status: 403 });
    }
    
    if (error instanceof Error && error.message.includes('not in a failed state')) {
      return NextResponse.json({ error: 'Document is not in a failed state', details: error.message }, { status: 400 });
    }
    
    return NextResponse.json(
      { error: 'Failed to process document action', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
} 