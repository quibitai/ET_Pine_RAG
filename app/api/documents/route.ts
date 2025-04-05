import { NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import { getAllUserDocuments } from '@/lib/services/document-service';

/**
 * GET /api/documents
 * Retrieve all documents for the authenticated user
 */
export async function GET(request: Request) {
  try {
    // Authenticate user
    const session = await auth();
    const userId = session?.user?.id;
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Get all documents for the user
    const documents = await getAllUserDocuments(userId);
    
    return NextResponse.json({ documents });
  } catch (error) {
    console.error('Error retrieving documents:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve documents', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
} 