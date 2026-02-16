import { openDB } from 'idb';

interface ChunkRow {
  transferId: string;
  index: number;
  data: string;
}

interface TransferRow {
  transferId: string;
  fileName: string;
  mimeType: string;
  fileType: 'image' | 'file';
  size: number;
  totalChunks: number;
  receivedChunks: number;
  text?: string;
}

const DB_NAME = 'nostr-p2p-files';
const DB_VERSION = 1;

const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('transfers')) {
      db.createObjectStore('transfers', { keyPath: 'transferId' });
    }
    if (!db.objectStoreNames.contains('chunks')) {
      db.createObjectStore('chunks', { keyPath: ['transferId', 'index'] });
    }
  },
});

function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function ensureTransfer(meta: Omit<TransferRow, 'receivedChunks'> & { receivedChunks?: number }) {
  const db = await dbPromise;
  const existing = (await db.get('transfers', meta.transferId)) as TransferRow | undefined;
  const row: TransferRow = {
    ...meta,
    receivedChunks: existing?.receivedChunks ?? meta.receivedChunks ?? 0,
  };
  await db.put('transfers', row);
  return row;
}

export async function storeChunk(transferId: string, index: number, totalChunks: number, data: string) {
  const db = await dbPromise;
  const tx = db.transaction(['chunks', 'transfers'], 'readwrite');
  const key = [transferId, index] as [string, number];
  const existing = await tx.objectStore('chunks').get(key);
  if (!existing) {
    await tx.objectStore('chunks').put({ transferId, index, data } as ChunkRow);
    const transfer = (await tx.objectStore('transfers').get(transferId)) as TransferRow | undefined;
    if (transfer) {
      transfer.receivedChunks = Math.min(transfer.totalChunks, transfer.receivedChunks + 1);
      await tx.objectStore('transfers').put(transfer);
    } else {
      await tx.objectStore('transfers').put({
        transferId,
        fileName: 'file',
        mimeType: 'application/octet-stream',
        fileType: 'file',
        size: 0,
        totalChunks,
        receivedChunks: 1,
      } as TransferRow);
    }
  }
  await tx.done;
}

export async function getTransfer(transferId: string) {
  const db = await dbPromise;
  return (await db.get('transfers', transferId)) as TransferRow | undefined;
}

export async function isTransferComplete(transferId: string): Promise<boolean> {
  const transfer = await getTransfer(transferId);
  if (!transfer) return false;
  return transfer.totalChunks > 0 && transfer.receivedChunks >= transfer.totalChunks;
}

export async function downloadChunkedTransfer(transferId: string, fallbackName?: string, fallbackMime?: string) {
  const db = await dbPromise;
  const transfer = (await db.get('transfers', transferId)) as TransferRow | undefined;
  if (!transfer) throw new Error('Transfer not found');

  const fileName = fallbackName || transfer.fileName || 'file';
  const mimeType = fallbackMime || transfer.mimeType || 'application/octet-stream';

  const range = IDBKeyRange.bound([transferId, 0], [transferId, Number.MAX_SAFE_INTEGER]);
  const store = db.transaction('chunks', 'readonly').objectStore('chunks');

  const useFsApi =
    typeof window !== 'undefined' &&
    'showSaveFilePicker' in window &&
    window.isSecureContext;

  if (useFsApi) {
    const picker = (window as unknown as { showSaveFilePicker: (opts: object) => Promise<{ createWritable: () => Promise<{ write: (chunk: Uint8Array) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker;
    const handle = await picker({
      suggestedName: fileName,
      types: [{ description: 'File', accept: { [mimeType]: ['.' + fileName.split('.').pop()] } }],
    });
    const writable = await handle.createWritable();
    let cursor = await store.openCursor(range);
    while (cursor) {
      const row = cursor.value as ChunkRow;
      await writable.write(base64ToBytes(row.data));
      cursor = await cursor.continue();
    }
    await writable.close();
    return;
  }

  const parts: Uint8Array[] = [];
  let cursor = await store.openCursor(range);
  while (cursor) {
    const row = cursor.value as ChunkRow;
    parts.push(base64ToBytes(row.data));
    cursor = await cursor.continue();
  }
  const blob = new Blob(parts, { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
