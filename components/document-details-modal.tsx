import { useState } from 'react';
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
  ClockIcon
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { formatFileSize, formatDate } from '@/lib/utils';

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
};

interface DocumentDetailsModalProps {
  document: Document | null;
  isOpen: boolean;
  onClose: () => void;
}

export function DocumentDetailsModal({ document, isOpen, onClose }: DocumentDetailsModalProps) {
  const [activeTab, setActiveTab] = useState('general');
  
  if (!document) {
    return null;
  }
  
  // Calculate processing progress percentage
  const progress = document.totalChunks && document.processedChunks 
    ? Math.round((document.processedChunks / document.totalChunks) * 100) 
    : 0;

  // Get file icon based on file type
  const getFileIcon = (fileType: string) => {
    if (fileType.includes('pdf')) {
      return <FileTextIcon className="h-5 w-5" />;
    } else if (fileType.includes('image')) {
      return <ImageIcon className="h-5 w-5" />;
    } else if (fileType.includes('spreadsheet') || fileType.includes('csv')) {
      return <SheetIcon className="h-5 w-5" />;
    } else {
      return <FileIcon className="h-5 w-5" />;
    }
  };

  // Get status icon based on processing status
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircleIcon className="h-5 w-5 text-green-500" />;
      case 'processing':
        return <Loader2Icon className="h-5 w-5 text-blue-500 animate-spin" />;
      case 'pending':
        return <ClockIcon className="h-5 w-5 text-yellow-500" />;
      case 'failed':
        return <AlertCircleIcon className="h-5 w-5 text-red-500" />;
      default:
        return <ClockIcon className="h-5 w-5 text-yellow-500" />;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getFileIcon(document.fileType)}
            <span className="truncate">{document.fileName}</span>
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
          </TabsContent>
          
          <TabsContent value="processing" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1 col-span-2">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-muted-foreground">Processing Status</p>
                  {getStatusIcon(document.processingStatus)}
                </div>
                <p className="text-sm capitalize">{document.processingStatus}</p>
              </div>
              
              {document.statusMessage && (
                <div className="space-y-1 col-span-2">
                  <p className="text-sm font-medium text-muted-foreground">Status Message</p>
                  <p className="text-sm break-words">{document.statusMessage}</p>
                </div>
              )}
              
              {document.totalChunks && document.processedChunks !== undefined && (
                <>
                  <div className="space-y-1 col-span-2">
                    <p className="text-sm font-medium text-muted-foreground">Processing Progress</p>
                    <Progress value={progress} className="h-2" />
                    <p className="text-xs text-right mt-1">{progress}% complete</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">Total Chunks</p>
                    <p className="text-sm">{document.totalChunks}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">Processed Chunks</p>
                    <p className="text-sm">{document.processedChunks}</p>
                  </div>
                </>
              )}
            </div>
          </TabsContent>
          
          <TabsContent value="technical" className="space-y-4">
            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Document ID</p>
                <p className="text-sm font-mono break-all">{document.id}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Blob URL</p>
                <p className="text-sm font-mono break-all">{document.blobUrl}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Created (ISO)</p>
                <p className="text-sm font-mono">{new Date(document.createdAt).toISOString()}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Updated (ISO)</p>
                <p className="text-sm font-mono">{new Date(document.updatedAt).toISOString()}</p>
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