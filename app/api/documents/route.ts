import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import { getAllUserDocuments } from '@/lib/services/document-service';

/**
 * GET /api/documents
 * Retrieve all documents for the authenticated user
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const user = session?.user;
    
    if (!user || !user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    console.info(`Fetching documents for user ${user.id}`);
    const documents = await getAllUserDocuments(user.id);
    
    return NextResponse.json({ documents });
  } catch (error) {
    console.error('Error fetching documents:', error);
    return NextResponse.json(
      { error: 'Failed to fetch documents' },
      { status: 500 }
    );
  }
} 