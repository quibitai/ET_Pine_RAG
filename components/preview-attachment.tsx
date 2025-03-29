import type { Attachment } from 'ai';

import { FileIcon, FileTextIcon, LoaderIcon } from './icons';

export const PreviewAttachment = ({
  attachment,
  isUploading = false,
}: {
  attachment: Attachment;
  isUploading?: boolean;
}) => {
  const { name, url, contentType } = attachment;

  const getFileIcon = () => {
    if (!contentType) return <FileIcon size={24} />;
    
    if (contentType.startsWith('image')) {
      return (
        // NOTE: it is recommended to use next/image for images
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={url}
          src={url}
          alt={name ?? 'An image attachment'}
          className="rounded-md size-full object-cover"
        />
      );
    } else if (contentType === 'application/pdf') {
      return <FileIcon size={24} className="text-red-500" />;
    } else if (contentType === 'text/plain') {
      return <FileTextIcon size={24} className="text-blue-500" />;
    } else if (contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      return <FileTextIcon size={24} className="text-indigo-500" />;
    } else {
      return <FileIcon size={24} />;
    }
  };

  return (
    <div data-testid="input-attachment-preview" className="flex flex-col gap-2">
      <div className="w-20 h-16 aspect-video bg-muted rounded-md relative flex flex-col items-center justify-center">
        {getFileIcon()}

        {isUploading && (
          <div
            data-testid="input-attachment-loader"
            className="animate-spin absolute text-zinc-500"
          >
            <LoaderIcon />
          </div>
        )}
      </div>
      <div className="text-xs text-zinc-500 max-w-16 truncate">{name}</div>
    </div>
  );
};
