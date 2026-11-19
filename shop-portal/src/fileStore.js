// Keeps the artwork files of cart items in the browser (IndexedDB) so they survive a page refresh.
// localStorage cannot hold files.  If IndexedDB is blocked everything still works for this visit.
let dbPromise;
function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error("IndexedDB not available")); return; }
      const req = indexedDB.open("shop-portal-artwork", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("files");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

async function run(mode, work) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", mode);
    const out = work(tx.objectStore("files"));
    tx.oncomplete = () => resolve(out?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const saveFiles = (key, files) => run("readwrite", (s) => s.put(files, key)).catch(() => {});
export const loadFiles = (key) => run("readonly", (s) => s.get(key)).catch(() => undefined);
export const deleteFiles = (keys) => run("readwrite", (s) => { keys.forEach((k) => s.delete(k)); }).catch(() => {});