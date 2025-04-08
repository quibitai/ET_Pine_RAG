import { useState, useEffect } from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  FileIcon,
  FileTextIcon,
  ImageIcon,
  SheetIcon,
  Loader2Icon,
  XIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  ClockIcon,
  EyeIcon,
  DownloadIcon,
  ExternalLinkIcon,
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { formatFileSize, formatDate } from '@/lib/utils';
import { toast } from 'sonner';

// Document type definition
type Document = {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  statusMessage?: string | null;
  createdAt: Date;
  updatedAt: Date;
  blobUrl: string;
  totalChunks?: number | null;
  processedChunks?: number | null;
  folderPath?: string | null;
  title?: string | null;
  content?: string | null; // Optional content field
};

interface DocumentDetailsModalProps {
  document: Document | null;
  isOpen: boolean;
  onClose: () => void;
}

// Helper function to get file icon based on file type
function getFileIcon(fileType: string) {
  if (fileType.includes('image')) {
    return <ImageIcon className="h-4 w-4 text-blue-500" />;
  } else if (fileType.includes('sheet') || fileType.includes('csv') || fileType.includes('excel')) {
    return <SheetIcon className="h-4 w-4 text-green-500" />;
  } else if (fileType.includes('code')) {
    return <FileIcon className="h-4 w-4 text-purple-500" />;
  } else {
    return <FileTextIcon className="h-4 w-4 text-gray-500" />;
  }
}

// Helper function to get process status icon
function getStatusIcon(status: string) {
  switch (status) {
    case 'completed':
      return <CheckCircleIcon className="h-4 w-4 text-green-500" />;
    case 'failed':
      return <AlertCircleIcon className="h-4 w-4 text-red-500" />;
    case 'pending':
    case 'processing':
      return <ClockIcon className="h-4 w-4 text-amber-500" />;
    default:
      return <ClockIcon className="h-4 w-4 text-gray-500" />;
  }
}

export function DocumentDetailsModal({ document, isOpen, onClose }: DocumentDetailsModalProps) {
  const [activeTab, setActiveTab] = useState('general');
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [documentContent, setDocumentContent] = useState<string | null>(null);
  const [isContentLoading, setIsContentLoading] = useState(false);

  // Reset states when document changes
  useEffect(() => {
    setIsPreviewVisible(false);
    setDocumentContent(null);
    setIsContentLoading(false);
  }, [document?.id]);

  if (!document) {
    return null;
  }

  const processingProgress = document.processedChunks && document.totalChunks 
    ? Math.round((document.processedChunks / document.totalChunks) * 100) 
    : 0;

  const canViewContent = document.processingStatus === 'completed' && 
    (document.fileType?.includes('text') || 
     document.fileType?.includes('json') || 
     document.fileType?.includes('code'));

  // Handle document preview
  const handleViewDocument = async () => {
    if (!document) return;
    
    // If we already have content, just show it
    if (documentContent) {
      setIsPreviewVisible(true);
      return;
    }
    
    // Try to load content if not already loaded
    try {
      setIsContentLoading(true);
      
      // First check if document has a content property already
      if (document.content) {
        setDocumentContent(document.content);
        setIsPreviewVisible(true);
        setIsContentLoading(false);
        return;
      }
      
      // Otherwise, try to load from localStorage if this is an artifact type document
      if (typeof window !== 'undefined' && document.fileType?.includes('text')) {
        const storageKey = `document-content-${document.id}`;
        const cachedContent = localStorage.getItem(storageKey);
        
        if (cachedContent) {
          setDocumentContent(cachedContent);
          setIsPreviewVisible(true);
          setIsContentLoading(false);
          return;
        }
      }
      
      // As a last resort, try to fetch the document content from the API
      const response = await fetch(`/api/documents/${document.id}/download`);
      if (response.ok) {
        const content = await response.text();
        setDocumentContent(content);
        setIsPreviewVisible(true);
      } else {
        toast.error('Could not load document content.');
      }
    } catch (error) {
      console.error('Error loading document content:', error);
      toast.error('Failed to load document preview');
    } finally {
      setIsContentLoading(false);
    }
  };

  // Handle document download
  const handleDownloadDocument = async () => {
    if (!document) return;
    
    try {
      setIsDownloading(true);
      
      // Create a download link
      const downloadUrl = `/api/documents/${document.id}/download`;
      
      // Create an invisible anchor tag and trigger download
      const a = window.document.createElement('a');
      a.href = downloadUrl;
      a.download = document.fileName || `document-${document.id}`;
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      
      toast.success('Download started');
    } catch (error) {
      console.error('Error downloading document:', error);
      toast.error('Failed to download document');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getFileIcon(document.fileType)}
            <span className="truncate max-w-[85%]">{document.fileName}</span>
          </DialogTitle>
          <DialogDescription>
            Detailed document information
          </DialogDescription>
        </DialogHeader>
        
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid grid-cols-3 mb-4">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="processing">Processing</TabsTrigger>
            <TabsTrigger value="technical">Technical</TabsTrigger>
          </TabsList>
          
          <TabsContent value="general" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">File Name</p>
                <p className="text-sm break-words">{document.fileName}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">File Size</p>
                <p className="text-sm">{formatFileSize(document.fileSize)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">File Type</p>
                <p className="text-sm">{document.fileType}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Folder Path</p>
                <p className="text-sm break-words">{document.folderPath || '-'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Created</p>
                <p className="text-sm">{formatDate(document.createdAt)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Last Updated</p>
                <p className="text-sm">{formatDate(document.updatedAt)}</p>
              </div>
              <div className="space-y-1 col-span-2">
                <p className="text-sm font-medium text-muted-foreground">Title</p>
                <p className="text-sm break-words">{document.title || '-'}</p>
              </div>
            </div>
            
            <div className="pt-4 flex flex-col gap-4">
              {isPreviewVisible && documentContent && (
                <div className="border rounded-md p-3 mb-2">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="text-sm font-medium">Document Preview</h3>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => setIsPreviewVisible(false)}
                    >
                      <XIcon className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto bg-muted p-2 rounded text-xs font-mono whitespace-pre-wrap">
                    {documentContent}
                  </div>
                </div>
              )}
              
              <div className="flex gap-2 justify-end">
                {canViewContent && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleViewDocument}
                    disabled={isContentLoading}
                  >
                    {isContentLoading ? (
                      <Loader2Icon className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <EyeIcon className="h-4 w-4 mr-2" />
                    )}
                    View Content
                  </Button>
                )}
                
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleDownloadDocument}
                  disabled={isDownloading}
                >
                  {isDownloading ? (
                    <Loader2Icon className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <DownloadIcon className="h-4 w-4 mr-2" />
                  )}
                  Download
                </Button>
                
                {document.blobUrl && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(document.blobUrl, '_blank')}
                  >
                    <ExternalLinkIcon className="h-4 w-4 mr-2" />
                    Open Original
                  </Button>
                )}
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="processing" className="space-y-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">Status</p>
                  {getStatusIcon(document.processingStatus)}
                  <span className="capitalize text-sm">{document.processingStatus}</span>
                </div>
                
                {document.statusMessage && (
                  <p className="text-sm text-muted-foreground">{document.statusMessage}</p>
                )}
              </div>
              
              {document.processingStatus === 'processing' && document.totalChunks && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Processing Progress</span>
                    <span>{processingProgress}%</span>
                  </div>
                  <Progress value={processingProgress} />
                  <p className="text-xs text-muted-foreground">
                    Processed {document.processedChunks || 0} of {document.totalChunks} chunks
                  </p>
                </div>
              )}
            </div>
          </TabsContent>
          
          <TabsContent value="technical" className="space-y-4">
            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Document ID</p>
                <p className="text-sm font-mono break-all overflow-hidden">{document.id}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Blob URL</p>
                <div className="max-w-full overflow-hidden">
                  <p className="text-sm font-mono overflow-wrap-anywhere break-all">{document.blobUrl}</p>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Created (ISO)</p>
                <p className="text-sm font-mono overflow-wrap-anywhere break-all">{new Date(document.createdAt).toISOString()}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Updated (ISO)</p>
                <p className="text-sm font-mono overflow-wrap-anywhere break-all">{new Date(document.updatedAt).toISOString()}</p>
              </div>
            </div>
          </TabsContent>
        </Tabs>
        
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 