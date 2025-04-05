import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import { 
  getDocumentDetails, 
  deleteDocument, 
  retryDocumentProcessing,
  getDocumentProgress
} from '@/lib/services/document-service';

/**
 * GET /api/documents/[id]
 * Get details for a specific document
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    const user = session?.user;

    if (!user || !user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = params;
    console.info(`Fetching document details for document ${id}`);
    
    const document = await getDocumentDetails(id);
    
    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }
    
    // Check document ownership
    if (document.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized access to document' }, { status: 403 });
    }
    
    return NextResponse.json({ document });
  } catch (error) {
    console.error('Error fetching document details:', error);
    return NextResponse.json(
      { error: 'Failed to fetch document details' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/documents/[id]
 * Delete a document and its associated data
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    const user = session?.user;

    if (!user || !user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = params;
    console.info(`Deleting document ${id}`);
    
    await deleteDocument(id, user.id);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting document:', error);
    return NextResponse.json(
      { 
        error: 'Failed to delete document',
        message: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/documents/[id]
 * Retry processing a document
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    const user = session?.user;

    if (!user || !user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = params;
    const body = await request.json();
    
    if (body.action !== 'retry') {
      return NextResponse.json(
        { error: 'Invalid action. Only "retry" is supported.' },
        { status: 400 }
      );
    }
    
    console.info(`Retrying processing for document ${id}`);
    await retryDocumentProcessing(id, user.id);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error retrying document processing:', error);
    return NextResponse.json(
      { 
        error: 'Failed to retry document processing',
        message: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
} 