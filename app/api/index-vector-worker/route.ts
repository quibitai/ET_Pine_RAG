import { generateEmbeddings } from '@/lib/ai/utils';
import { getPineconeIndex } from '@/lib/pinecone-client';
import { getDocumentById, updateFileRagStatus, incrementProcessedChunks } from '@/lib/db/queries';
import logger from '@/lib/logger';

export async function POST(request: Request) {
  try {
    const requestBody = await request.json();
    logger.info("Received vector indexing request", { 
      documentId: requestBody.documentId,
      chunkIndex: requestBody.chunkIndex,
      totalChunks: requestBody.totalChunks
    });
    
    // Validate required fields
    const requiredFields = ['documentId', 'userId', 'chunkText', 'chunkIndex', 'totalChunks', 'source'];
    for (const field of requiredFields) {
      if (!requestBody[field]) {
        logger.error(`Missing required field: ${field}`);
        return Response.json({ success: false, error: `Missing required field: ${field}` }, { status: 400 });
      }
    }
    
    // Extract variables
    const { documentId, userId, chunkText, chunkIndex, totalChunks, source } = requestBody;
    
    // Generate embedding
    logger.debug("Generating embedding for chunk", { 
      chunkIndex,
      textLength: chunkText.length
    });
    
    try {
      const embedding = await generateEmbeddings(chunkText);
      logger.debug("Successfully generated embedding", { 
        chunkIndex,
        vectorDimensions: embedding.length
      });
      
      // Prepare the payload for Pinecone
      const payload = {
        id: `${documentId}-chunk-${chunkIndex}`,
        values: embedding,
        metadata: {
          userId,
          documentId,
          text: chunkText,
          source,
          chunkIndex
        }
      };
      
      // Get index
      const index = getPineconeIndex();
      
      // Insert into Pinecone
      logger.info("Inserting vector into Pinecone", { 
        vectorId: payload.id,
        documentId,
        chunkIndex,
        userId: userId.substring(0, 8) // Only log part of the userId for privacy
      });
      
      await index.upsert([payload]);
      
      // Update the document status
      await incrementProcessedChunks({ id: documentId });
      
      // Get document status
      const document = await getDocumentById(documentId);
      if (!document) {
        logger.error("Document not found", { documentId });
        return Response.json(
          { success: false, error: "Document not found" },
          { status: 404 }
        );
      }
      
      // Check if this was the last chunk
      const processedChunks = document.processedChunks || 0;
      const isComplete = processedChunks >= totalChunks;
      
      logger.info("Vector indexing progress", { 
        documentId,
        processedChunks,
        totalChunks,
        percentComplete: Math.round((processedChunks / totalChunks) * 100),
        isComplete
      });
      
      // If all chunks processed, mark document as complete
      if (isComplete) {
        await updateFileRagStatus({
          id: documentId,
          processingStatus: 'completed',
          statusMessage: `Successfully processed all ${totalChunks} chunks`,
        });
        logger.info("Document processing complete", { documentId, totalChunks });
      }
      
      return Response.json({ success: true, chunkIndex, processedChunks, totalChunks });
    } catch (embeddingError) {
      logger.error("Error generating embedding", embeddingError);
      return Response.json(
        { success: false, error: "Embedding generation failed" },
        { status: 500 }
      );
    }
  } catch (error) {
    logger.error("Error in vector worker", error);
    return Response.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
} 