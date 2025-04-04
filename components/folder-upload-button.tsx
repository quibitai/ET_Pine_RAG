'use client';

import { useState, useRef } from 'react';
import { FolderIcon, Loader2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface FolderUploadButtonProps {
  onUploadComplete?: (results: UploadResult[]) => void;
  className?: string;
}

interface UploadResult {
  documentId: string;
  url: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  folderPath: string;
}

// Extend the HTMLAttributes for input to include webkitdirectory and directory
declare module 'react' {
  interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
    // Add non-standard attributes
    webkitdirectory?: string;
    directory?: string;
  }
}

export function FolderUploadButton({ 
  onUploadComplete,
  className
}: FolderUploadButtonProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    total: number;
    completed: number;
  }>({ total: 0, completed: 0 });
  
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFolderSelection = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    setIsUploading(true);
    setUploadProgress({ total: files.length, completed: 0 });

    try {
      const uploadResults: UploadResult[] = [];
      
      // Process files in batches to avoid overwhelming the server
      const BATCH_SIZE = 5;
      const batches = Math.ceil(files.length / BATCH_SIZE);
      
      for (let i = 0; i < batches; i++) {
        const batchFiles = files.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
        
        // Process the batch in parallel
        const batchPromises = batchFiles.map(async (file) => {
          try {
            // Get the relative path of the file within the directory structure
            const fullPath = (file as any).webkitRelativePath || '';
            // Remove the top-level folder name from the path to get the relative path
            const folderPath = fullPath.split('/').slice(1, -1).join('/');
            
            const result = await uploadFile(file, folderPath);
            if (result) {
              uploadResults.push(result);
              setUploadProgress(prev => ({
                ...prev,
                completed: prev.completed + 1
              }));
            }
            return result;
          } catch (error) {
            console.error(`Error uploading file ${file.name}:`, error);
            return null;
          }
        });
        
        await Promise.all(batchPromises);
      }
      
      if (uploadResults.length > 0) {
        toast.success(`Successfully uploaded ${uploadResults.length} files`);
        onUploadComplete?.(uploadResults);
      } else {
        toast.error('Failed to upload any files');
      }
    } catch (error) {
      console.error('Error uploading folder:', error);
      toast.error('Failed to upload folder');
    } finally {
      setIsUploading(false);
      setUploadProgress({ total: 0, completed: 0 });
      
      // Reset file input
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    }
  };
  
  const uploadFile = async (file: File, folderPath: string): Promise<UploadResult | null> => {
    const formData = new FormData();
    formData.append('file', file);
    
    // Add folder path to form data if available
    if (folderPath) {
      formData.append('folderPath', folderPath);
    }

    try {
      const response = await fetch('/api/files/upload', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        return {
          ...data,
          folderPath
        };
      }
      
      const errorData = await response.json();
      console.error('Upload error:', errorData);
      return null;
    } catch (error) {
      console.error('Failed to upload file:', error);
      return null;
    }
  };

  return (
    <div className={className}>
      <input
        type="file"
        ref={inputRef}
        onChange={handleFolderSelection}
        className="hidden"
        webkitdirectory="true"
        directory="true"
        multiple
      />
      
      <Button
        variant="outline"
        className="gap-2"
        onClick={() => inputRef.current?.click()}
        disabled={isUploading}
      >
        {isUploading ? (
          <>
            <Loader2Icon className="h-4 w-4 animate-spin" />
            <span>
              Uploading... ({uploadProgress.completed}/{uploadProgress.total})
            </span>
          </>
        ) : (
          <>
            <FolderIcon className="h-4 w-4" />
            <span>Upload Folder</span>
          </>
        )}
      </Button>
    </div>
  );
} 