export interface OfflineQueuedSubmission {
  idempotencyKey: string;
  applicantName: string;
  cnic: string;
  age: number | null;
  monthlyIncome: number | null;
  householdDetails: string;
  contactPhone: string;
  district: string;
  targetCitizenId?: number;
  offlineCreatedAt: string;
  status: 'pending_sync' | 'sync_error';
  lastError?: string;
}

export interface OfflineDraftRecord {
  id: string;
  applicantName: string;
  cnicMaskedPreview: string;
  age: string;
  monthlyIncome: string;
  householdDetails: string;
  contactPhone: string;
  district: string;
  savedAt: string;
}

export interface SyncHistoryEvent {
  id: string;
  idempotencyKey: string;
  caseCode: string;
  applicantName: string;
  syncedAt: string;
  outcome: 'synced' | 'duplicate_skipped';
}

const DB_NAME = 'madad_desk_offline_v1';
const DB_VERSION = 1;

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('outbox')) {
        db.createObjectStore('outbox', { keyPath: 'idempotencyKey' });
      }
      if (!db.objectStoreNames.contains('drafts')) {
        db.createObjectStore('drafts', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('syncHistory')) {
        db.createObjectStore('syncHistory', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllFromStore<T>(storeName: string): Promise<T[]> {
  if (typeof indexedDB === 'undefined') return [];
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as T[]) || []);
    req.onerror = () => reject(req.error);
  });
}

async function putInStore<T>(storeName: string, value: T): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteFromStore(storeName: string, key: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listQueuedSubmissions(): Promise<OfflineQueuedSubmission[]> {
  return getAllFromStore<OfflineQueuedSubmission>('outbox');
}

export async function enqueueOfflineSubmission(item: OfflineQueuedSubmission): Promise<void> {
  await putInStore('outbox', item);
}

export async function removeQueuedSubmission(idempotencyKey: string): Promise<void> {
  await deleteFromStore('outbox', idempotencyKey);
}

export async function saveLocalDraft(draft: OfflineDraftRecord): Promise<void> {
  await putInStore('drafts', draft);
}

export async function loadLocalDraft(id = 'active_citizen_draft'): Promise<OfflineDraftRecord | null> {
  const all = await getAllFromStore<OfflineDraftRecord>('drafts');
  return all.find((d) => d.id === id) || null;
}

export async function clearLocalDraft(id = 'active_citizen_draft'): Promise<void> {
  await deleteFromStore('drafts', id);
}

export async function recordSyncHistory(event: SyncHistoryEvent): Promise<void> {
  await putInStore('syncHistory', event);
}

export async function listSyncHistory(): Promise<SyncHistoryEvent[]> {
  const rows = await getAllFromStore<SyncHistoryEvent>('syncHistory');
  return rows.sort((a, b) => b.syncedAt.localeCompare(a.syncedAt));
}
