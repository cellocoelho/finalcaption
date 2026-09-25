// Projetos salvos: legendas, estilo, miniatura e a referência ao arquivo de vídeo.
//
// Fica no IndexedDB (não no localStorage, que é pequeno demais para vários projetos e
// não guarda binários). Quando o navegador permite, guardamos também o "handle" do
// arquivo — assim dá para reabrir o vídeo sem procurar a pasta de novo.

const DB_NAME = 'finalcaptions';
const STORE = 'projects';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

/** Resumo de cada projeto, do mais recente para o mais antigo (sem os dados pesados). */
export async function listProjects() {
  let rows = [];
  try { rows = (await tx('readonly', (st) => st.getAll())) || []; } catch { return []; }
  return rows
    .map(({ key, name, savedAt, captionCount, duration, thumb, handle }) =>
      ({ key, name, savedAt, captionCount, duration, thumb, hasHandle: !!handle }))
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

export async function getProject(key) {
  try { return (await tx('readonly', (st) => st.get(key))) || null; } catch { return null; }
}

export async function saveProject(rec) {
  try { await tx('readwrite', (st) => st.put(rec)); return true; } catch { return false; }
}

export async function deleteProject(key) {
  try { await tx('readwrite', (st) => st.delete(key)); } catch { /* ignora */ }
}

/** Junta campos a um projeto já salvo, sem reescrever o resto. */
export async function patchProject(key, patch) {
  const cur = await getProject(key);
  if (!cur) return;
  await saveProject({ ...cur, ...patch });
}

/** Pede o arquivo de volta ao handle guardado. Devolve null se não der (precisa de clique). */
export async function fileFromHandle(handle) {
  if (!handle?.queryPermission) return null;
  try {
    let perm = await handle.queryPermission({ mode: 'read' });
    if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'read' });
    if (perm !== 'granted') return null;
    return await handle.getFile();
  } catch {
    return null;   // arquivo movido, renomeado ou apagado
  }
}

// ---------------------------------------------------------------- migração

const OLD_PREFIX = 'finalcaptions:project:v1:';

/** Traz para o IndexedDB o que ficou guardado no localStorage das versões anteriores. */
export async function migrateOldProjects() {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith(OLD_PREFIX));
  for (const k of keys) {
    const key = k.slice(OLD_PREFIX.length);
    try {
      const old = JSON.parse(localStorage.getItem(k) || 'null');
      if (old?.transcript?.length && !(await getProject(key))) {
        await saveProject({
          key,
          name: key.split('|')[0] || 'vídeo',
          savedAt: old.savedAt || Date.now(),
          captionCount: old.captions?.length || 0,
          duration: 0,
          transcript: old.transcript,
          captions: old.captions || [],
          style: old.style, seg: old.seg, language: old.language,
        });
      }
      localStorage.removeItem(k);
    } catch { localStorage.removeItem(k); }
  }
}
