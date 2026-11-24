/**
 * First-run seed import runs off the main thread.
 *
 * The app already opened the Dexie database before this worker starts, so the
 * worker only uses the existing object store. Writing 42 nested question
 * records on the main thread was the largest single source of blocking time
 * on a cold mobile load; IndexedDB is available to workers, so the work can
 * happen while the UI is responsive.
 */

const DB_NAME = 'cpns-bmgk-db';
const SEED_URL = '/seed-questions.json';
const BATCH_SIZE = 12;

type SeedResult =
  | { type: 'done'; imported: number }
  | { type: 'error'; message: string };

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

async function run(): Promise<SeedResult> {
  const database = await openDatabase();
  try {
    if (!database.objectStoreNames.contains('questions')) {
      throw new Error('questions object store missing');
    }

    const total = await request(
      database.transaction('questions', 'readonly').objectStore('questions').count()
    );
    if (total !== 0) return { type: 'done', imported: 0 };

    const response = await fetch(SEED_URL);
    if (!response.ok) throw new Error(`seed fetch failed: ${response.status}`);
    const payload = (await response.json()) as { data?: { questions?: unknown[] } };
    const questions = payload.data?.questions ?? [];
    if (questions.length === 0) return { type: 'done', imported: 0 };

    for (let offset = 0; offset < questions.length; offset += BATCH_SIZE) {
      const batch = questions.slice(offset, offset + BATCH_SIZE);
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('questions', 'readwrite');
        const store = transaction.objectStore('questions');
        for (const question of batch) store.put(question);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    }

    return { type: 'done', imported: questions.length };
  } finally {
    database.close();
  }
}

self.addEventListener('message', () => {
  void run()
    .then((result) => self.postMessage(result))
    .catch((error: unknown) => {
      self.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      } satisfies SeedResult);
    });
});
