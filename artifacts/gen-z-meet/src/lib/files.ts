import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB max
export const MAX_FILE_SIZE_LABEL = '50 MB';

export type SharedFile = {
  id: string;
  meetingId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  uploaderId: string;
  uploaderName: string;
  storagePath: string;
  downloadUrl: string;
  createdAt?: { seconds: number; nanoseconds: number } | string | number | null;
};

export type FileUploadProgress = {
  fileName: string;
  fileSize: number;
  progress: number; // 0 to 100
  status: 'uploading' | 'saving' | 'completed' | 'error';
  errorMessage?: string;
};

/**
 * Uploads a file via fast streaming XMLHttpRequest with real-time byte progress,
 * and publishes the file metadata into Firestore under rooms/{meetingId}/files/{fileId}.
 */
export async function uploadSharedFile({
  meetingId,
  file,
  uploaderId,
  uploaderName,
  onProgress,
}: {
  meetingId: string;
  file: File;
  uploaderId: string;
  uploaderName: string;
  onProgress?: (progress: number) => void;
}): Promise<SharedFile> {
  if (!meetingId || !file) {
    throw new Error('Invalid meeting or file provided.');
  }

  if (file.size === 0) {
    throw new Error('Selected file is empty.');
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `File is too large (${formatFileSize(file.size)}). Maximum allowed size is ${MAX_FILE_SIZE_LABEL}.`
    );
  }

  return new Promise<SharedFile>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const uploadUrl = `/api/meetings/${encodeURIComponent(meetingId)}/files/upload`;

    xhr.open('POST', uploadUrl, true);
    xhr.timeout = 45000; // 45s timeout to prevent any indefinite hanging

    // Metadata headers
    xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));
    xhr.setRequestHeader('x-file-type', file.type || getFallbackFileType(file.name));
    xhr.setRequestHeader('x-file-size', file.size.toString());
    xhr.setRequestHeader('x-uploader-id', uploaderId || 'guest');
    xhr.setRequestHeader('x-uploader-name', encodeURIComponent(uploaderName || 'Participant'));
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');

    // Real byte-level upload progress tracking
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        const percentComplete = Math.min(98, Math.round((event.loaded / event.total) * 100));
        onProgress?.(percentComplete);
      }
    };

    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          onProgress?.(99);
          const responseData = JSON.parse(xhr.responseText) as SharedFile;

          const sharedFile: SharedFile = {
            id: responseData.id,
            meetingId,
            fileName: responseData.fileName || file.name,
            fileSize: responseData.fileSize || file.size,
            fileType: responseData.fileType || file.type || getFallbackFileType(file.name),
            uploaderId: responseData.uploaderId || uploaderId,
            uploaderName: responseData.uploaderName || uploaderName || 'Participant',
            storagePath: responseData.storagePath || '',
            downloadUrl: responseData.downloadUrl,
          };

          // Save metadata in Firestore for real-time room sync
          try {
            const fileDocRef = doc(db, 'rooms', meetingId, 'files', sharedFile.id);
            await setDoc(fileDocRef, {
              ...sharedFile,
              createdAt: serverTimestamp(),
            });
          } catch (fsErr) {
            console.warn('[File Sharing] Firestore sync fallback:', fsErr);
          }

          onProgress?.(100);
          resolve(sharedFile);
        } catch (parseErr) {
          console.error('[File Sharing] Parse response error:', parseErr);
          reject(new Error('Invalid response from file upload server.'));
        }
      } else {
        let errMsg = `Upload failed (status ${xhr.status}). Please try again.`;
        if (xhr.status === 404) {
          errMsg = 'Upload route not found. Please restart the backend server (pnpm run dev) to apply new routes.';
        } else if (xhr.status === 413) {
          errMsg = 'File is too large. Maximum allowed size is 50 MB.';
        } else {
          try {
            const errData = JSON.parse(xhr.responseText);
            if (errData?.error) errMsg = errData.error;
          } catch {}
        }
        reject(new Error(errMsg));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error during upload. Please check your connection.'));
    };

    xhr.ontimeout = () => {
      reject(new Error('Upload timed out. Please try again with a faster connection.'));
    };

    xhr.onabort = () => {
      reject(new Error('Upload was cancelled.'));
    };

    // Send the raw file binary stream
    xhr.send(file);
  });
}

/**
 * Subscribes to real-time shared files for a meeting room in Firestore.
 */
export function subscribeSharedFiles(
  meetingId: string,
  onFilesChanged: (files: SharedFile[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  if (!meetingId) {
    onFilesChanged([]);
    return () => {};
  }

  const filesCol = collection(db, 'rooms', meetingId, 'files');
  const filesQuery = query(filesCol, orderBy('createdAt', 'desc'));

  return onSnapshot(
    filesQuery,
    (snapshot) => {
      const files: SharedFile[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as SharedFile;
        files.push({
          ...data,
          id: docSnap.id,
        });
      });
      onFilesChanged(files);
    },
    (err) => {
      // Fallback: If ordered query fails without index, try unordered collection
      console.warn('[File Sharing] Ordered query failed, falling back to unordered listener:', err);
      return onSnapshot(
        filesCol,
        (fallbackSnap) => {
          const files: SharedFile[] = [];
          fallbackSnap.forEach((docSnap) => {
            const data = docSnap.data() as SharedFile;
            files.push({
              ...data,
              id: docSnap.id,
            });
          });
          files.sort((a, b) => {
            const timeA = getTimestampMs(a.createdAt);
            const timeB = getTimestampMs(b.createdAt);
            return timeB - timeA;
          });
          onFilesChanged(files);
        },
        (fallbackErr) => {
          console.error('[File Sharing] Unordered listener failed:', fallbackErr);
          onError?.(new Error('Could not listen for shared files.'));
        }
      );
    }
  );
}

/**
 * Safely downloads or opens a shared file without navigating away from the meeting room.
 */
export async function downloadSharedFile(file: SharedFile): Promise<void> {
  if (!file.downloadUrl) {
    throw new Error('Download URL is missing or invalid.');
  }

  const downloadUrl = file.downloadUrl.startsWith('http')
    ? file.downloadUrl
    : `${window.location.origin}${file.downloadUrl}`;

  try {
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.download = file.fileName || 'download';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err) {
    console.error('[File Sharing] Download error:', err);
    window.open(downloadUrl, '_blank', 'noopener,noreferrer');
  }
}

/**
 * Formats byte count into human-readable representation (e.g. 2.4 MB, 512 KB).
 */
export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(val >= 10 || i === 0 ? 0 : 1)} ${units[i] ?? 'MB'}`;
}

function getTimestampMs(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') return new Date(ts).getTime() || 0;
  if (typeof ts === 'object' && 'seconds' in (ts as { seconds: number })) {
    return (ts as { seconds: number }).seconds * 1000;
  }
  return 0;
}

export function formatFileTime(ts: unknown): string {
  const ms = getTimestampMs(ts);
  if (!ms) return 'Just now';
  return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
}

function getFallbackFileType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['pdf'].includes(ext)) return 'application/pdf';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return `image/${ext}`;
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'application/zip';
  if (['doc', 'docx'].includes(ext)) return 'application/msword';
  if (['xls', 'xlsx'].includes(ext)) return 'application/vnd.ms-excel';
  if (['ppt', 'pptx'].includes(ext)) return 'application/vnd.ms-powerpoint';
  if (['txt', 'md', 'csv', 'json', 'ts', 'tsx', 'js', 'html', 'css'].includes(ext)) return 'text/plain';
  return 'application/octet-stream';
}

export function getFileCategory(
  fileType?: string,
  fileName?: string
): 'pdf' | 'image' | 'archive' | 'document' | 'spreadsheet' | 'presentation' | 'code' | 'video' | 'audio' | 'generic' {
  const type = (fileType || '').toLowerCase();
  const name = (fileName || '').toLowerCase();

  if (type.includes('pdf') || name.endsWith('.pdf')) return 'pdf';
  if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/.test(name)) return 'image';
  if (type.includes('zip') || type.includes('compressed') || type.includes('tar') || /\.(zip|rar|7z|tar|gz)$/.test(name)) return 'archive';
  if (type.includes('word') || /\.(doc|docx)$/.test(name)) return 'document';
  if (type.includes('excel') || type.includes('spreadsheet') || type.includes('csv') || /\.(xls|xlsx|csv)$/.test(name)) return 'spreadsheet';
  if (type.includes('powerpoint') || type.includes('presentation') || /\.(ppt|pptx)$/.test(name)) return 'presentation';
  if (type.includes('javascript') || type.includes('typescript') || type.includes('json') || /\.(ts|tsx|js|jsx|json|html|css|py|rs|go|sql)$/.test(name)) return 'code';
  if (type.startsWith('video/') || /\.(mp4|mov|webm|mkv)$/.test(name)) return 'video';
  if (type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a)$/.test(name)) return 'audio';
  return 'generic';
}
