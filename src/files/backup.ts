/**
 * Pre-save backups in IndexedDB. The File System Access API gives us a handle
 * to the ROM file only — we can't create sibling .bak files without directory
 * permission — so backups live in the browser instead (last 3 per file name),
 * retrievable via download.
 */

const DB_NAME = 'moveset-editor'
const STORE = 'backups'
const KEEP = 3

export interface BackupRecord {
  key: string
  fileName: string
  when: number
  bytes: Uint8Array
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function asPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function stashBackup(fileName: string, bytes: Uint8Array): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const record: BackupRecord = { key: `${fileName}:${Date.now()}`, fileName, when: Date.now(), bytes }
    store.put(record)
    const all = await asPromise(store.getAll() as IDBRequest<BackupRecord[]>)
    all
      .filter((r) => r.fileName === fileName)
      .sort((a, b) => b.when - a.when)
      .slice(KEEP)
      .forEach((r) => store.delete(r.key))
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export async function latestBackup(fileName: string): Promise<BackupRecord | null> {
  const db = await openDb()
  try {
    const store = db.transaction(STORE, 'readonly').objectStore(STORE)
    const all = await asPromise(store.getAll() as IDBRequest<BackupRecord[]>)
    const mine = all.filter((r) => r.fileName === fileName).sort((a, b) => b.when - a.when)
    return mine[0] ?? null
  } finally {
    db.close()
  }
}
