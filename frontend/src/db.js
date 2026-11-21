// A very small wrapper around IndexedDB, the database that lives inside the browser.
// Three stores: docs (inspections), queue (changes waiting to be sent), meta (settings).

export function openDb(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const idb = request.result;
      idb.createObjectStore("docs", { keyPath: "id" });
      idb.createObjectStore("queue", { keyPath: "op_id" });
      idb.createObjectStore("meta");
    };
    request.onsuccess = () => resolve(wrap(request.result));
    request.onerror = () => reject(request.error);
  });
}

function wrap(idb) {
  const read = (store, fn) =>
    new Promise((resolve, reject) => {
      const tx = idb.transaction(store, "readonly");
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });

  return {
    getAll: (store) => read(store, (s) => s.getAll()),
    get: (store, key) => read(store, (s) => s.get(key)),
    // Several writes as one all-or-nothing unit, so a closed tab never leaves half a change behind.
    write(writes) {
      if (!writes.length) return Promise.resolve();
      const stores = [...new Set(writes.map((w) => w.store))];
      return new Promise((resolve, reject) => {
        const tx = idb.transaction(stores, "readwrite");
        for (const w of writes) {
          const s = tx.objectStore(w.store);
          if (w.delete !== undefined) s.delete(w.delete);
          else if (w.clear) s.clear();
          else s.put(w.value, w.key);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    },
    close: () => idb.close(),
  };
}
