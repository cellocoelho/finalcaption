// Fontes enviadas pelo usuário (.ttf / .otf).
// Ficam guardadas no IndexedDB deste navegador e são registradas com a FontFace API,
// então valem para a prévia e para o MP4 exportado (o mesmo drawCaption desenha os dois).

const DB_NAME = 'finalcaptions-fonts';
const STORE = 'files';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

// ---------------------------------------------------------------- leitura do arquivo

const tag = (view, o) => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));

/** Lê nome da família, peso e itálico direto do arquivo da fonte. */
function readFontInfo(buffer, fallbackName) {
  const info = { family: fallbackName, weight: 400, italic: false };
  try {
    const view = new DataView(buffer);
    const version = view.getUint32(0);
    if (version !== 0x00010000 && tag(view, 0) !== 'OTTO' && tag(view, 0) !== 'true') return info;
    const tables = {};
    const count = view.getUint16(4);
    for (let i = 0; i < count; i++) {
      const rec = 12 + i * 16;
      tables[tag(view, rec)] = { off: view.getUint32(rec + 8), len: view.getUint32(rec + 12) };
    }

    const name = tables.name;
    if (name) {
      const base = name.off;
      const n = view.getUint16(base + 2);
      const strBase = base + view.getUint16(base + 4);
      let best = null, bestScore = -1;
      for (let i = 0; i < n; i++) {
        const r = base + 6 + i * 12;
        const platform = view.getUint16(r), nameId = view.getUint16(r + 6);
        if (nameId !== 1 && nameId !== 16) continue;
        const len = view.getUint16(r + 8), off = strBase + view.getUint16(r + 10);
        if (off + len > view.byteLength) continue;
        let text = '';
        if (platform === 3 || platform === 0) {
          for (let k = 0; k + 1 < len; k += 2) text += String.fromCharCode(view.getUint16(off + k));
        } else {
          for (let k = 0; k < len; k++) text += String.fromCharCode(view.getUint8(off + k));
        }
        text = text.replace(/\0/g, '').trim();
        if (!text) continue;
        const score = (nameId === 16 ? 2 : 0) + (platform === 3 ? 1 : 0);
        if (score > bestScore) { bestScore = score; best = text; }
      }
      if (best) info.family = best;
    }

    const os2 = tables['OS/2'];
    if (os2 && os2.off + 64 <= view.byteLength) {
      const w = view.getUint16(os2.off + 4);
      if (w >= 1 && w <= 1000) info.weight = w;
      info.italic = (view.getUint16(os2.off + 62) & 1) === 1;
    } else if (tables.head && tables.head.off + 46 <= view.byteLength) {
      const macStyle = view.getUint16(tables.head.off + 44);
      if (macStyle & 1) info.weight = 700;
      info.italic = (macStyle & 2) === 2;
    }
  } catch { /* usa o nome do arquivo */ }
  return info;
}

// ---------------------------------------------------------------- registro no navegador

const registered = new Map(); // id -> FontFace

async function register(rec) {
  if (registered.has(rec.id)) return rec;
  const face = new FontFace(rec.family, rec.data, {
    weight: String(rec.weight),
    style: rec.italic ? 'italic' : 'normal',
    display: 'block',
  });
  await face.load();
  document.fonts.add(face);
  registered.set(rec.id, face);
  return rec;
}

/** Fontes guardadas, já registradas e prontas para usar. Devolve [{ id, family, weight, italic, fileName }]. */
export async function loadStoredFonts() {
  if (!('indexedDB' in window)) return [];
  let rows = [];
  try {
    const db = await openDb();
    rows = (await tx(db, 'readonly', (st) => st.getAll())) || [];
  } catch { return []; }
  const ok = [];
  for (const r of rows) {
    try { await register(r); ok.push(meta(r)); } catch { /* arquivo inválido: ignora */ }
  }
  return ok;
}

const meta = (r) => ({ id: r.id, family: r.family, weight: r.weight, italic: r.italic, fileName: r.fileName });

/** Guarda e registra uma fonte enviada. Devolve os dados dela. */
export async function addFont(file) {
  if (!/\.(ttf|otf)$/i.test(file.name)) throw new Error('Envie um arquivo .ttf ou .otf.');
  const data = await file.arrayBuffer();
  const info = readFontInfo(data, file.name.replace(/\.[^.]+$/, ''));
  const rec = { id: `${info.family}|${info.weight}|${info.italic}`, family: info.family, weight: info.weight, italic: info.italic, fileName: file.name, data };
  await register(rec);
  try {
    const db = await openDb();
    await tx(db, 'readwrite', (st) => st.put(rec));
  } catch { /* sem espaço: vale só nesta sessão */ }
  return meta(rec);
}

export async function removeFont(id) {
  const face = registered.get(id);
  if (face) { document.fonts.delete(face); registered.delete(id); }
  try {
    const db = await openDb();
    await tx(db, 'readwrite', (st) => st.delete(id));
  } catch { /* ignora */ }
}
