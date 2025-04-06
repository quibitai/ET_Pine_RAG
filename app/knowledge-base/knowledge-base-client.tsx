'use client';

import { useState, useEffect } from 'react';
import { User } from 'next-auth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  FileIcon,
  FileTextIcon,
  ImageIcon,
  InfoIcon,
  Loader2Icon,
  PencilIcon,
  RefreshCwIcon,
  SheetIcon,
  SparklesIcon,
  Trash2Icon,
  ArrowLeftIcon,
  DownloadIcon,
  EyeIcon,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { fetcher, formatFileSize } from '@/lib/utils';
import { FolderUploadButton } from '@/components/folder-upload-button';
import { DocumentDetailsModal } from '@/components/document-details-modal';

// Types for document
type Document = {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  statusMessage?: string;
  createdAt: Date;
  updatedAt: Date;
  blobUrl: string;
  totalChunks?: number;
  processedChunks?: number;
  folderPath?: string;
  title?: string;
};

// Helper function to get file icon
function getFileIcon(fileType: string) {
  if (fileType.includes('pdf')) {
    return <FileTextIcon className="h-4 w-4" />;
  } else if (fileType.includes('image')) {
    return <ImageIcon className="h-4 w-4" />;
  } else if (fileType.includes('spreadsheet') || fileType.includes('csv')) {
    return <SheetIcon className="h-4 w-4" />;
  } else {
    return <FileIcon className="h-4 w-4" />;
  }
}

// Helper function to get status badge
function getStatusBadge(status: string) {
  switch (status) {
    case 'pending':
      return <Badge variant="outline">Pending</Badge>;
    case 'processing':
      return <Badge variant="secondary">Processing</Badge>;
    case 'completed':
      return <Badge variant="success">Completed</Badge>;
    case 'failed':
      return <Badge variant="destructive">Failed</Badge>;
    default:
      return <Badge variant="outline">Unknown</Badge>;
  }
}

export default function KnowledgeBaseClient({ user }: { user: User }) {
  const router = useRouter();
  const [sortField, setSortField] = useState<string>('createdAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState<string | null>(null);
  
  // Add state for selected documents
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  
  // Add state for document details modal
  const [detailsDocument, setDetailsDocument] = useState<Document | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  
  // Fetch all documents for the user
  const { data, error, isLoading, mutate } = useSWR<{ documents: Document[] }>('/api/documents', fetcher);
  
  // Handle errors in fetching documents
  useEffect(() => {
    if (error) {
      toast.error('Failed to load documents');
    }
  }, [error]);
  
  // Sort documents
  const sortedDocuments = data?.documents
    ? [...data.documents].sort((a, b) => {
        const aValue = a[sortField as keyof Document];
        const bValue = b[sortField as keyof Document];
        
        if (aValue === null) return sortDirection === 'asc' ? -1 : 1;
        if (bValue === null) return sortDirection === 'asc' ? 1 : -1;
        
        if (typeof aValue === 'string' && typeof bValue === 'string') {
          return sortDirection === 'asc'
            ? aValue.localeCompare(bValue)
            : bValue.localeCompare(aValue);
        }
        
        if (aValue instanceof Date && bValue instanceof Date) {
          return sortDirection === 'asc'
            ? aValue.getTime() - bValue.getTime()
            : bValue.getTime() - aValue.getTime();
        }
        
        if (typeof aValue === 'number' && typeof bValue === 'number') {
          return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
        }
        
        return 0;
      })
    : [];
  
  // Toggle sort direction
  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };
  
  // Handle document deletion
  const handleDelete = async (id: string) => {
    try {
      setIsDeleting(id);
      const response = await fetch(`/api/documents/${id}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete document');
      }
      
      toast.success('Document deleted successfully');
      mutate(); // Refresh the document list
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete document');
    } finally {
      setIsDeleting(null);
    }
  };
  
  // Handle retry processing
  const handleRetry = async (id: string) => {
    try {
      setIsRetrying(id);
      const response = await fetch(`/api/documents/${id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'retry' }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to retry processing');
      }
      
      toast.success('Document processing requeued');
      mutate(); // Refresh the document list
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to retry processing');
    } finally {
      setIsRetrying(null);
    }
  };
  
  // Handle document upload
  const handleUpload = () => {
    // Open file selection dialog directly instead of redirecting
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = '.pdf,.txt,.docx,.doc,.xlsx,.xls,.csv,.md';
    
    fileInput.onchange = async (event) => {
      const files = Array.from((event.target as HTMLInputElement).files || []);
      if (!files.length) return;
      
      // Upload each file
      let successCount = 0;
      for (const file of files) {
        try {
          const formData = new FormData();
          formData.append('file', file);
          
          const response = await fetch('/api/files/upload', {
            method: 'POST',
            body: formData,
          });
          
          if (response.ok) {
            successCount++;
          } else {
            console.error(`Failed to upload ${file.name}`);
            const errorData = await response.json();
            toast.error(`Failed to upload ${file.name}: ${errorData.error || 'Unknown error'}`);
          }
        } catch (error) {
          console.error(`Error uploading ${file.name}:`, error);
          toast.error(`Error uploading ${file.name}`);
        }
      }
      
      if (successCount > 0) {
        toast.success(`Successfully uploaded ${successCount} file${successCount === 1 ? '' : 's'}`);
        mutate(); // Refresh the document list
      }
    };
    
    fileInput.click();
  };
  
  // Handle batch document deletion
  const handleBatchDelete = async () => {
    if (selectedDocuments.length === 0) {
      return;
    }
    
    try {
      setIsDeleting('batch');
      
      const response = await fetch('/api/documents/batch', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ documentIds: selectedDocuments }),
      });
      
      const responseData = await response.json();
      
      if (!response.ok) {
        throw new Error(responseData.error || 'Failed to delete documents');
      }
      
      if (responseData.results && responseData.results.failed && responseData.results.failed.length > 0) {
        // Some documents failed to delete
        toast.warning(`${responseData.results.success.length} documents deleted, ${responseData.results.failed.length} failed`);
      } else {
        // All documents deleted successfully
        toast.success(`${selectedDocuments.length} documents deleted successfully`);
      }
      
      // Clear selection and exit select mode
      setSelectedDocuments([]);
      setSelectMode(false);
      
      mutate(); // Refresh the document list
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete documents');
    } finally {
      setIsDeleting(null);
    }
  };
  
  // Handle select all documents
  const handleSelectAll = () => {
    if (sortedDocuments && sortedDocuments.length > 0) {
      if (selectedDocuments.length === sortedDocuments.length) {
        // If all documents are selected, deselect all
        setSelectedDocuments([]);
      } else {
        // Otherwise, select all documents
        setSelectedDocuments(sortedDocuments.map(doc => doc.id));
      }
    }
  };
  
  // Handle individual document selection
  const handleSelectDocument = (id: string) => {
    setSelectedDocuments(prev => {
      if (prev.includes(id)) {
        return prev.filter(docId => docId !== id);
      } else {
        return [...prev, id];
      }
    });
  };
  
  // Handle showing document details
  const handleShowDetails = (document: Document) => {
    setDetailsDocument(document);
    setIsDetailsModalOpen(true);
  };
  
  // Add handleDocumentDownload function to the component
  const handleDocumentDownload = async (docId: string, fileName: string) => {
    try {
      // Create a download link
      const downloadUrl = `/api/documents/${docId}/download`;
      
      // Create an invisible anchor tag and trigger download
      const a = window.document.createElement('a');
      a.href = downloadUrl;
      a.download = fileName;
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      
      toast.success('Download started');
    } catch (error) {
      console.error('Error downloading document:', error);
      toast.error('Failed to download document');
    }
  };
  
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => router.push('/')}
            title="Return to chat"
            className="flex items-center gap-1"
          >
            <ArrowLeftIcon className="h-4 w-4" /> 
            <span>Back to Chat</span>
          </Button>
          <p className="text-sm text-muted-foreground">
            Manage your knowledge base documents
          </p>
        </div>
        <div className="flex gap-2">
          {selectMode ? (
            <>
              <Button 
                variant="outline" 
                onClick={() => {
                  setSelectMode(false);
                  setSelectedDocuments([]);
                }}
              >
                Cancel
              </Button>
              <Button 
                variant="destructive" 
                onClick={handleBatchDelete}
                disabled={selectedDocuments.length === 0 || isDeleting !== null}
              >
                {isDeleting === 'batch' ? (
                  <Loader2Icon className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                Delete Selected ({selectedDocuments.length})
              </Button>
            </>
          ) : (
            <>
              <Button 
                variant="outline" 
                onClick={() => setSelectMode(true)}
                disabled={!sortedDocuments || sortedDocuments.length === 0}
              >
                Select
              </Button>
              <FolderUploadButton 
                onUploadComplete={(results) => {
                  mutate(); // Refresh documents after upload completes
                }}
              />
              <Button onClick={handleUpload}>
                Upload Document
              </Button>
            </>
          )}
        </div>
      </div>
      
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {selectMode && (
                <TableHead className="w-[50px]">
                  <Checkbox 
                    checked={sortedDocuments && sortedDocuments.length > 0 && selectedDocuments.length === sortedDocuments.length}
                    onCheckedChange={handleSelectAll}
                  />
                </TableHead>
              )}
              <TableHead 
                className="w-[300px] cursor-pointer"
                onClick={() => toggleSort('fileName')}
              >
                <div className="flex items-center">
                  File Name
                  {sortField === 'fileName' && (
                    sortDirection === 'asc' ? 
                      <ChevronUpIcon className="ml-1 h-4 w-4" /> : 
                      <ChevronDownIcon className="ml-1 h-4 w-4" />
                  )}
                </div>
              </TableHead>
              <TableHead>
                <div className="flex items-center">
                  Folder Path
                </div>
              </TableHead>
              <TableHead 
                className="cursor-pointer"
                onClick={() => toggleSort('fileSize')}
              >
                <div className="flex items-center">
                  Size
                  {sortField === 'fileSize' && (
                    sortDirection === 'asc' ? 
                      <ChevronUpIcon className="ml-1 h-4 w-4" /> : 
                      <ChevronDownIcon className="ml-1 h-4 w-4" />
                  )}
                </div>
              </TableHead>
              <TableHead 
                className="cursor-pointer"
                onClick={() => toggleSort('createdAt')}
              >
                <div className="flex items-center">
                  Created
                  {sortField === 'createdAt' && (
                    sortDirection === 'asc' ? 
                      <ChevronUpIcon className="ml-1 h-4 w-4" /> : 
                      <ChevronDownIcon className="ml-1 h-4 w-4" />
                  )}
                </div>
              </TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={selectMode ? 7 : 6} className="h-24 text-center">
                  <div className="flex justify-center items-center h-full">
                    <Loader2Icon className="h-6 w-6 animate-spin mr-2" />
                    <span>Loading documents...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : sortedDocuments && sortedDocuments.length > 0 ? (
              sortedDocuments.map((doc) => (
                <TableRow key={doc.id} className={selectedDocuments.includes(doc.id) ? 'bg-muted' : ''}>
                  {selectMode && (
                    <TableCell>
                      <Checkbox 
                        checked={selectedDocuments.includes(doc.id)}
                        onCheckedChange={() => handleSelectDocument(doc.id)}
                      />
                    </TableCell>
                  )}
                  <TableCell className="font-medium">
                    <div className="flex items-center">
                      {getFileIcon(doc.fileType)}
                      <span className="ml-2 truncate max-w-[250px]">{doc.fileName}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {doc.folderPath ? (
                      <span className="text-xs text-muted-foreground">
                        {doc.folderPath}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>{formatFileSize(doc.fileSize)}</TableCell>
                  <TableCell>{new Date(doc.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    {doc.processingStatus === 'completed' && (
                      <Badge variant="success" className="bg-green-500">
                        Completed
                      </Badge>
                    )}
                    {doc.processingStatus === 'processing' && (
                      <Badge variant="outline" className="border-blue-500 text-blue-500">
                        <Loader2Icon className="h-3 w-3 mr-1 animate-spin" />
                        Processing
                        {doc.processedChunks !== undefined && doc.totalChunks && doc.totalChunks > 0 && (
                          <span className="ml-1 text-xs">
                            ({Math.round((doc.processedChunks / doc.totalChunks) * 100)}%)
                          </span>
                        )}
                      </Badge>
                    )}
                    {doc.processingStatus === 'pending' && (
                      <Badge variant="outline" className="border-yellow-500 text-yellow-500">
                        Pending
                      </Badge>
                    )}
                    {doc.processingStatus === 'failed' && (
                      <Badge variant="destructive">
                        Failed
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button 
                        variant="ghost" 
                        size="icon"
                        onClick={() => handleShowDetails(doc)}
                        title="View Details"
                      >
                        <InfoIcon className="h-4 w-4" />
                        <span className="sr-only">View details</span>
                      </Button>
                      
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <PencilIcon className="h-4 w-4" />
                            <span className="sr-only">Open menu</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem 
                            onClick={() => router.push(`/?documentId=${doc.id}`)}
                            className="cursor-pointer"
                          >
                            <SparklesIcon className="h-4 w-4 mr-2" />
                            <span>Chat with document</span>
                          </DropdownMenuItem>
                          
                          {/* Add View Document option for text-based files */}
                          {(doc.fileType.includes('text') || 
                            doc.fileType.includes('json') || 
                            doc.fileType.includes('code')) && (
                            <DropdownMenuItem 
                              onClick={() => handleShowDetails(doc)}
                              className="cursor-pointer"
                            >
                              <EyeIcon className="h-4 w-4 mr-2" />
                              <span>View document</span>
                            </DropdownMenuItem>
                          )}
                          
                          {/* Add Download Document option */}
                          <DropdownMenuItem 
                            onClick={() => handleDocumentDownload(doc.id, doc.fileName)}
                            className="cursor-pointer"
                          >
                            <DownloadIcon className="h-4 w-4 mr-2" />
                            <span>Download document</span>
                          </DropdownMenuItem>
                          
                          {doc.processingStatus === 'failed' && (
                            <DropdownMenuItem 
                              onClick={() => handleRetry(doc.id)}
                              className="cursor-pointer"
                              disabled={!!isRetrying}
                            >
                              {isRetrying === doc.id ? (
                                <Loader2Icon className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <RefreshCwIcon className="h-4 w-4 mr-2" />
                              )}
                              <span>Retry processing</span>
                            </DropdownMenuItem>
                          )}
                          
                          <DropdownMenuSeparator />
                          
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <DropdownMenuItem 
                                onSelect={(e) => e.preventDefault()}
                                className="cursor-pointer text-destructive focus:text-destructive"
                              >
                                <Trash2Icon className="h-4 w-4 mr-2" />
                                <span>Delete document</span>
                              </DropdownMenuItem>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will permanently delete the document and all associated data.
                                  This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDelete(doc.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  {isDeleting === doc.id ? (
                                    <Loader2Icon className="h-4 w-4 mr-2 animate-spin" />
                                  ) : (
                                    "Delete"
                                  )}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={selectMode ? 7 : 6} className="h-24 text-center">
                  <div className="flex flex-col items-center justify-center h-full">
                    <p className="text-muted-foreground mb-2">No documents found</p>
                    <div className="flex gap-2">
                      <FolderUploadButton />
                      <Button variant="outline" onClick={handleUpload}>
                        Upload your first document
                      </Button>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      
      {/* Batch Delete Confirmation Dialog */}
      <AlertDialog open={selectedDocuments.length > 0 && isDeleting === 'batch'}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deleting Multiple Documents</AlertDialogTitle>
            <AlertDialogDescription>
              Deleting {selectedDocuments.length} documents. Please wait...
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex justify-center my-4">
            <Loader2Icon className="h-8 w-8 animate-spin" />
          </div>
        </AlertDialogContent>
      </AlertDialog>
      
      {/* Document Details Modal */}
      <DocumentDetailsModal
        document={detailsDocument}
        isOpen={isDetailsModalOpen}
        onClose={() => setIsDetailsModalOpen(false)}
      />
    </div>
  );
} 