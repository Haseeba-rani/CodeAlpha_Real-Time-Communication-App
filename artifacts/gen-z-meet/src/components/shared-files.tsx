import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Archive,
  ArrowDownToLine,
  Check,
  File,
  FileCode,
  FileSpreadsheet,
  FileText,
  FolderArchive,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Plus,
  UploadCloud,
  Video as VideoIcon,
  Music,
} from 'lucide-react';
import {
  downloadSharedFile,
  formatFileSize,
  formatFileTime,
  getFileCategory,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
  subscribeSharedFiles,
  uploadSharedFile,
  type FileUploadProgress,
  type SharedFile,
} from '@/lib/files';

export function FileCategoryIcon({ category }: { category: ReturnType<typeof getFileCategory> }) {
  switch (category) {
    case 'pdf':
      return (
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-500/15 text-red-400">
          <FileText size={18} />
        </div>
      );
    case 'image':
      return (
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-400">
          <ImageIcon size={18} />
        </div>
      );
    case 'archive':
      return (
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-400">
          <Archive size={18} />
        </div>
      );
    case 'spreadsheet':
      return (
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-green-500/15 text-green-400">
          <FileSpreadsheet size={18} />
        </div>
      );
    case 'code':
      return (
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cyan-500/15 text-cyan-400">
          <FileCode size={18} />
        </div>
      );
    case 'video':
      return (
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-purple-500/15 text-purple-400">
          <VideoIcon size={18} />
        </div>
      );
    case 'audio':
      return (
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-pink-500/15 text-pink-400">
          <Music size={18} />
        </div>
      );
    case 'presentation':
    case 'document':
      return (
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-500/15 text-blue-400">
          <FileText size={18} />
        </div>
      );
    default:
      return (
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
          <File size={18} />
        </div>
      );
  }
}

export function SharedFilesCard({
  meetingId,
  currentUserId,
  currentUserName,
  isLive = true,
  onTriggerFileInputRef,
  className = '',
}: {
  meetingId: string;
  currentUserId: string;
  currentUserName: string;
  isLive?: boolean;
  onTriggerFileInputRef?: React.MutableRefObject<(() => void) | null>;
  className?: string;
}) {
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [uploadTask, setUploadTask] = useState<FileUploadProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadedId, setDownloadedId] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Expose file input trigger to external controls (e.g. meeting bar)
  useEffect(() => {
    if (onTriggerFileInputRef) {
      onTriggerFileInputRef.current = () => {
        fileInputRef.current?.click();
      };
    }
    return () => {
      if (onTriggerFileInputRef) {
        onTriggerFileInputRef.current = null;
      }
    };
  }, [onTriggerFileInputRef]);

  // Real-time Firestore listener for files in this room
  useEffect(() => {
    if (!meetingId) return;

    const unsubscribe = subscribeSharedFiles(
      meetingId,
      (updatedFiles) => {
        setFiles(updatedFiles);
      },
      (err) => {
        console.error('[SharedFiles] Subscription error:', err);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [meetingId]);

  const handleFileSelection = async (selectedFile?: File | null) => {
    if (!selectedFile) return;
    setErrorMessage(null);

    // Client-side file size validation
    if (selectedFile.size > MAX_FILE_SIZE_BYTES) {
      setErrorMessage(
        `File is too large (${formatFileSize(selectedFile.size)}). Maximum allowed size is ${MAX_FILE_SIZE_LABEL}.`
      );
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (selectedFile.size === 0) {
      setErrorMessage('Selected file is empty.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setUploadTask({
      fileName: selectedFile.name,
      fileSize: selectedFile.size,
      progress: 5,
      status: 'uploading',
    });

    try {
      await uploadSharedFile({
        meetingId,
        file: selectedFile,
        uploaderId: currentUserId,
        uploaderName: currentUserName || 'Participant',
        onProgress: (pct) => {
          setUploadTask((prev) =>
            prev
              ? {
                  ...prev,
                  progress: pct,
                  status: pct >= 100 ? 'saving' : 'uploading',
                }
              : null
          );
        },
      });

      setUploadTask((prev) =>
        prev ? { ...prev, progress: 100, status: 'completed' } : null
      );

      setTimeout(() => {
        setUploadTask(null);
      }, 2500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed. Please try again.';
      setErrorMessage(msg);
      setUploadTask((prev) =>
        prev ? { ...prev, status: 'error', errorMessage: msg } : null
      );
      setTimeout(() => {
        setUploadTask(null);
      }, 4000);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDownload = async (file: SharedFile) => {
    setDownloadingId(file.id);
    try {
      await downloadSharedFile(file);
      setDownloadedId(file.id);
      setTimeout(() => setDownloadedId(null), 2500);
    } catch (err) {
      console.error('[SharedFiles] Download failed:', err);
      setErrorMessage('Could not download file. Please try again.');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (isLive) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (!isLive) return;
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      void handleFileSelection(droppedFile);
    }
  };

  return (
    <div
      className={`rounded-2xl border border-primary/25 bg-card p-5 transition-all ${
        isDragOver ? 'border-primary ring-2 ring-primary/20 bg-primary/[.03]' : ''
      } ${className}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFileSelection(file);
        }}
        data-testid="input-shared-file"
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary/15 text-primary">
            <Paperclip size={15} />
          </span>
          <div>
            <span className="font-mono-ui text-[10px] uppercase tracking-[.16em] text-primary">
              Shared Files
            </span>
            <div className="font-display text-base font-semibold">
              Files in Room{' '}
              <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 font-mono-ui text-xs font-bold text-primary">
                {files.length}
              </span>
            </div>
          </div>
        </div>

        {isLive && (
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadTask?.status === 'uploading'}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground shadow-sm hover:brightness-105 disabled:opacity-50"
            data-testid="button-share-file"
            title="Share a file with everyone in this room"
          >
            <Plus size={14} />
            <span>Share file</span>
          </button>
        )}
      </div>

      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        Real-time room files. Every participant can upload and download documents instantly.
      </p>

      {/* Error Message */}
      {errorMessage && (
        <div
          className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
          role="alert"
        >
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <div className="flex-1">
            <span className="font-semibold">{errorMessage}</span>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="ml-auto text-xs text-destructive hover:underline"
          >
            ×
          </button>
        </div>
      )}

      {/* Active Upload Card */}
      {uploadTask && (
        <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3.5 animate-rise">
          <div className="flex items-center justify-between text-xs">
            <div className="flex min-w-0 items-center gap-2">
              {uploadTask.status === 'completed' ? (
                <Check size={15} className="text-primary shrink-0" />
              ) : uploadTask.status === 'error' ? (
                <AlertCircle size={15} className="text-destructive shrink-0" />
              ) : (
                <UploadCloud size={15} className="animate-bounce text-primary shrink-0" />
              )}
              <span className="truncate font-semibold" title={uploadTask.fileName}>
                {uploadTask.fileName}
              </span>
            </div>
            <span className="font-mono-ui text-[11px] text-muted-foreground shrink-0 ml-2">
              {uploadTask.status === 'completed'
                ? 'Uploaded ✓'
                : uploadTask.status === 'saving'
                ? 'Finishing…'
                : `${uploadTask.progress}%`}
            </span>
          </div>

          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border">
            <div
              className={`h-full transition-all duration-200 ${
                uploadTask.status === 'completed'
                  ? 'bg-primary'
                  : uploadTask.status === 'error'
                  ? 'bg-destructive'
                  : 'bg-primary animate-pulse'
              }`}
              style={{ width: `${Math.max(5, uploadTask.progress)}%` }}
            />
          </div>

          <div className="mt-2 flex justify-between text-[10px] text-muted-foreground font-mono-ui">
            <span>{formatFileSize(uploadTask.fileSize)}</span>
            <span>
              {uploadTask.status === 'completed'
                ? 'Visible to all participants'
                : uploadTask.status === 'saving'
                ? 'Syncing room…'
                : 'Uploading…'}
            </span>
          </div>
        </div>
      )}

      {/* Files List */}
      <div className="mt-4 max-h-[320px] space-y-2.5 overflow-y-auto pr-1">
        {files.length > 0 ? (
          files.map((file) => {
            const category = getFileCategory(file.fileType, file.fileName);
            const isSelf = file.uploaderId === currentUserId;
            const isDownloading = downloadingId === file.id;
            const isDownloaded = downloadedId === file.id;

            return (
              <div
                key={file.id}
                className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-background p-3 transition-colors hover:border-primary/40 hover:bg-card/70"
                data-testid={`card-shared-file-${file.id}`}
              >
                <FileCategoryIcon category={category} />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="truncate font-semibold text-xs text-foreground group-hover:text-primary transition-colors"
                      title={file.fileName}
                    >
                      {file.fileName}
                    </span>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground font-mono-ui">
                    <span>{formatFileSize(file.fileSize)}</span>
                    <span>·</span>
                    <span className="truncate">
                      Shared by{' '}
                      <strong className="text-foreground font-semibold">
                        {file.uploaderName || 'Participant'}
                      </strong>
                      {isSelf && (
                        <span className="ml-1 rounded bg-primary/20 px-1 py-0.2 text-[9px] font-bold text-primary">
                          You
                        </span>
                      )}
                    </span>
                    <span>·</span>
                    <span>{formatFileTime(file.createdAt)}</span>
                  </div>
                </div>

                <button
                  onClick={() => void handleDownload(file)}
                  disabled={isDownloading}
                  className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-all ${
                    isDownloaded
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border bg-card hover:border-primary/40 hover:bg-muted text-foreground'
                  }`}
                  data-testid={`button-download-file-${file.id}`}
                  title={`Download ${file.fileName}`}
                >
                  {isDownloading ? (
                    <Loader2 size={13} className="animate-spin text-primary" />
                  ) : isDownloaded ? (
                    <Check size={13} className="text-primary" />
                  ) : (
                    <ArrowDownToLine size={13} />
                  )}
                  <span className="hidden sm:inline">
                    {isDownloaded ? 'Downloaded' : 'Download'}
                  </span>
                </button>
              </div>
            );
          })
        ) : (
          <div className="rounded-xl border border-dashed border-border/80 p-5 text-center">
            <div className="mx-auto grid h-9 w-9 place-items-center rounded-xl bg-muted/60 text-muted-foreground">
              <FolderArchive size={17} />
            </div>
            <p className="mt-2 text-xs font-medium text-muted-foreground">
              No files shared yet in this room.
            </p>
            {isLive && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
                data-testid="link-empty-share"
              >
                <Plus size={12} /> Share the first file
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
