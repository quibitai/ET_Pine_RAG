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
  Loader2Icon,
  PencilIcon,
  RefreshCwIcon,
  SheetIcon,
  SparklesIcon,
  Trash2Icon,
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
import { toast } from 'sonner';
import { fetcher } from '@/lib/utils';
import { FolderUploadButton } from '@/components/folder-upload-button';

// Types for document
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
};

// Helper function to format file size
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

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
    router.push('/'); // Navigate to the chat page for uploading
  };
  
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <p className="text-sm text-muted-foreground">
            Manage your knowledge base documents
          </p>
        </div>
        <div className="flex gap-2">
          <FolderUploadButton 
            onUploadComplete={(results) => {
              mutate(); // Refresh documents after upload completes
            }}
          />
          <Button onClick={handleUpload}>
            Upload Document
          </Button>
        </div>
      </div>
      
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
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
                onClick={() => toggleSort('processingStatus')}
              >
                <div className="flex items-center">
                  Status
                  {sortField === 'processingStatus' && (
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
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  <div className="flex justify-center items-center h-full">
                    <Loader2Icon className="h-6 w-6 animate-spin mr-2" />
                    <span>Loading documents...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : sortedDocuments && sortedDocuments.length > 0 ? (
              sortedDocuments.map((doc) => (
                <TableRow key={doc.id}>
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
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {getStatusBadge(doc.processingStatus)}
                      {doc.processingStatus === 'processing' && doc.totalChunks && doc.processedChunks !== null && (
                        <span className="text-xs text-muted-foreground">
                          {doc.processedChunks}/{doc.totalChunks}
                        </span>
                      )}
                    </div>
                    {doc.statusMessage && (
                      <p className="text-xs text-muted-foreground mt-1 truncate max-w-[200px]">
                        {doc.statusMessage}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    {new Date(doc.createdAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </TableCell>
                  <TableCell className="text-right">
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
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
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
    </div>
  );
} 