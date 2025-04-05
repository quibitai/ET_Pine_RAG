import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import { getDocumentById } from '@/lib/db/queries';
import { deleteDocument, getDocumentDetails } from '@/lib/services/document-service';

// Ensure this API route is always dynamically rendered
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/documents/batch
 * 
 * Batch delete documents based on provided document IDs
 */
export async function DELETE(request: Request) {
  try {
    // Verify authentication
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse request body to get document IDs
    const body = await request.json();
    const { documentIds } = body;

    if (!documentIds || !Array.isArray(documentIds) || documentIds.length === 0) {
      return NextResponse.json(
        { error: 'Invalid or missing documentIds' },
        { status: 400 }
      );
    }

    console.log(`[Batch Delete API] Deleting ${documentIds.length} documents`);

    // Track successful and failed deletions
    const results = {
      success: [] as string[],
      failed: [] as { id: string, error: string }[]
    };

    // Process each document ID
    for (const docId of documentIds) {
      try {
        // Verify document exists and belongs to user
        const docInfo = await getDocumentDetails(docId);
        
        if (!docInfo) {
          results.failed.push({ id: docId, error: 'Document not found' });
          continue;
        }
        
        if (docInfo.userId !== session.user.id) {
          results.failed.push({ id: docId, error: 'Unauthorized' });
          continue;
        }

        // Delete the document
        await deleteDocument(docId, session.user.id);
        results.success.push(docId);
        console.log(`[Batch Delete API] Successfully deleted document ${docId}`);
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[Batch Delete API] Error deleting document ${docId}:`, error);
        results.failed.push({ id: docId, error });
      }
    }

    return NextResponse.json({ 
      message: `Deleted ${results.success.length} documents, ${results.failed.length} failed`,
      results 
    });
  } catch (error) {
    console.error('[Batch Delete API] Error processing batch delete:', error);
    return NextResponse.json(
      { error: 'Failed to process batch delete' },
      { status: 500 }
    );
  }
} 