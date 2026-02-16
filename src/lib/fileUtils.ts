import type { Attachment } from './nostr';

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;
const INLINE_LIMIT = 8 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
const AUDIO_TYPES = ['audio/webm', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/aac'];

export function isImageType(mimeType: string): boolean {
  return IMAGE_TYPES.includes(mimeType);
}

export function isAudioType(mimeType: string): boolean {
  return AUDIO_TYPES.includes(mimeType) || mimeType.startsWith('audio/');
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function compressImage(file: File, maxWidth: number, maxHeight: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width;
      let h = img.height;
      if (w > maxWidth || h > maxHeight) {
        const ratio = Math.min(maxWidth / w, maxHeight / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas context unavailable'));
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve(dataUrl.split(',')[1]);
    };
    img.onerror = reject;
    img.src = url;
  });
}

export async function processFile(file: File): Promise<Attachment> {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File is too large. Maximum: ${formatFileSize(MAX_FILE_SIZE)}.`);
  }

  const isImage = isImageType(file.type);
  const isAudio = isAudioType(file.type);
  let mimeType = file.type || 'application/octet-stream';
  let attachmentType: 'image' | 'file' | 'audio' = 'file';

  if (isImage) {
      attachmentType = 'image';
      mimeType = 'image/jpeg';
  } else if (isAudio) {
      attachmentType = 'audio';
  }

  if (file.size > INLINE_LIMIT) {
    return {
      type: attachmentType,
      name: file.name,
      mimeType,
      data: '',
      size: file.size,
      file,
      chunked: true,
    };
  }

  const base64 = isImage && file.size > 200 * 1024
    ? await compressImage(file, 2048, 2048, 0.82)
    : await fileToBase64(file);

  return {
    type: attachmentType,
    name: file.name,
    mimeType,
    data: base64,
    size: file.size,
    file,
  };
}

export function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteChars = atob(base64);
  const byteNumbers = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  return new Blob([byteNumbers.buffer as ArrayBuffer], { type: mimeType });
}

export function downloadAttachment(attachment: Attachment) {
  const blob = base64ToBlob(attachment.data, attachment.mimeType);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = attachment.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.startsWith('video/')) return '🎬';
  if (mimeType.startsWith('audio/')) return '🎵';
  if (mimeType.includes('pdf')) return '📄';
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('tar')) return '📦';
  if (mimeType.includes('text')) return '📝';
  if (mimeType.includes('json') || mimeType.includes('xml')) return '⚙️';
  return '📎';
}
