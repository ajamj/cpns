/**
 * Minimal Anki .apkg writer (Phase 2, Task 6).
 *
 * An .apkg is a ZIP containing a SQLite `collection.anki2` database and a
 * `media` JSON map. Rather than pulling a native SQLite or ZIP dependency into
 * the browser bundle, this module writes the small subset of the SQLite file
 * format that Anki needs: leaf table b-trees, an internal root where necessary,
 * and overflow chains for large card fields.
 */
import type { Question } from '../../shared/types';

const PAGE_SIZE = 65536; // SQLite page size, encoded as 1 in the file header.
const MAX_LOCAL = PAGE_SIZE - 35;
const MIN_LOCAL = Math.floor(((PAGE_SIZE - 12) * 32) / 255) - 23;
const MODEL_ID = 1700000000000;
const DECK_BASE = 1700000000001;
const NOTE_BASE = 1700000001000;
const CARD_BASE = 1800000001000;

type SqlValue = number | string | null;
interface SqlRecord { rowid: number; values: SqlValue[] }

function bigEndian16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, false);
  return bytes;
}

function bigEndian32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, false);
  return bytes;
}

/** SQLite variable-length integer (up to 9 bytes, 7 bits each). */
function varint(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid SQLite varint: ${value}`);
  let remaining = BigInt(value);
  const bytes: number[] = [];
  while (remaining > 0n) {
    bytes.unshift(Number(remaining & 0x7fn));
    remaining >>= 7n;
  }
  if (bytes.length === 0) return Uint8Array.of(0);
  if (bytes.length > 9) throw new Error('SQLite varint overflow');
  for (let i = 0; i < bytes.length - 1; i++) bytes[i] = (bytes[i] ?? 0) | 0x80;
  return Uint8Array.from(bytes);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function encodeRecord(values: SqlValue[]): Uint8Array {
  const encoder = new TextEncoder();
  const serials: Uint8Array[] = [];
  const body: Uint8Array[] = [];
  for (const value of values) {
    if (value === null) {
      serials.push(Uint8Array.of(0));
    } else if (typeof value === 'number') {
      serials.push(varint(6)); // 8-byte signed integer for every numeric column
      const bytes = new Uint8Array(8);
      new DataView(bytes.buffer).setBigInt64(0, BigInt(Math.trunc(value)), false);
      body.push(bytes);
    } else {
      const bytes = encoder.encode(value);
      serials.push(varint(13 + 2 * bytes.length)); // TEXT serial type
      body.push(bytes);
    }
  }
  const headerSize = serials.reduce((sum, serial) => sum + serial.length, 0);
  if (headerSize >= 128) throw new Error('SQLite record header too large');
  return concat([varint(headerSize + 1), ...serials, ...body]);
}

/** Page-number allocator shared by all tables in the database. */
class PageAllocator {
  private next = 5; // 1 = sqlite_master, 2 = col, 3 = notes, 4 = cards
  reserve(count: number): number[] {
    const pages: number[] = [];
    for (let i = 0; i < count; i++) pages.push(this.next++);
    return pages;
  }
}

class BTreePage {
  readonly bytes = new Uint8Array(PAGE_SIZE);
  private cursor = PAGE_SIZE;
  private cells: number[] = [];
  readonly rowids: number[] = [];

  constructor(private readonly headerOffset: number) {}

  addCell(cell: Uint8Array, rowid: number): void {
    this.cursor -= cell.length;
    this.bytes.set(cell, this.cursor);
    this.cells.push(this.cursor);
    this.rowids.push(rowid);
  }

  get cellCount(): number { return this.cells.length; }
  get lastRowid(): number { return this.rowids[this.rowids.length - 1] ?? 0; }
  get freeSpace(): number { return this.cursor - this.headerOffset - 8 - this.cells.length * 2; }

  freespaceEnough(cellLength: number): boolean {
    return this.freeSpace >= 2 + cellLength;
  }

  seal(type: number): Uint8Array {
    const view = new DataView(this.bytes.buffer);
    const header = this.headerOffset;
    this.bytes[header] = type;
    view.setUint16(header + 3, this.cells.length, false);
    view.setUint16(header + 5, this.cursor === PAGE_SIZE ? 0 : this.cursor, false);
    this.cells.forEach((offset, index) => view.setUint16(header + 8 + index * 2, offset, false));
    return this.bytes;
  }
}

function payloadLayout(length: number): { local: number; overflow: boolean } {
  if (length <= MAX_LOCAL) return { local: length, overflow: false };
  let local = MIN_LOCAL + ((length - MIN_LOCAL) % (PAGE_SIZE - 4));
  if (local > MAX_LOCAL) local = MIN_LOCAL;
  return { local, overflow: true };
}

function buildTable(
  records: SqlRecord[],
  rootPage: number,
  allocator: PageAllocator,
  pages: Map<number, Uint8Array>
): void {
  const sorted = [...records].sort((a, b) => a.rowid - b.rowid);
  const prepared = sorted.map(record => {
    const payload = encodeRecord(record.values);
    const layout = payloadLayout(payload.length);
    const overflowCount = layout.overflow
      ? Math.ceil((payload.length - layout.local) / (PAGE_SIZE - 4))
      : 0;
    const cellLength = varint(payload.length).length + varint(record.rowid).length +
      layout.local + (layout.overflow ? 4 : 0);
    return { ...record, payload, layout, overflowCount, cellLength };
  });

  // Determine the exact number of leaf pages before allocating any page numbers.
  let used = 8;
  let leafCount = 0;
  for (const item of prepared) {
    if (used + 2 + item.cellLength > PAGE_SIZE) {
      leafCount++;
      used = 8;
    }
    used += 2 + item.cellLength;
  }
  leafCount = Math.max(1, leafCount + 1);
  // A single leaf can be the table root itself — reserving a separate page
  // would leave an unreferenced page and make SQLite's integrity check fail.
  const leaves = leafCount === 1 ? [rootPage] : allocator.reserve(leafCount);

  let leafIndex = 0;
  let page = new BTreePage(0);
  const maxRowids: number[] = [];
  for (const item of prepared) {
    if (!page.freespaceEnough(item.cellLength)) {
      pages.set(leaves[leafIndex]!, page.seal(0x0d));
      maxRowids.push(page.lastRowid);
      leafIndex++;
      page = new BTreePage(0);
    }

    let firstOverflowPage = 0;
    if (item.layout.overflow) {
      let offset = item.layout.local;
      let previous = 0;
      for (let i = 0; i < item.overflowCount; i++) {
        const overflowPage = allocator.reserve(1)[0]!;
        if (firstOverflowPage === 0) firstOverflowPage = overflowPage;
        const overflowBytes = new Uint8Array(PAGE_SIZE);
        new DataView(overflowBytes.buffer).setUint32(0, 0, false); // patched below
        const chunk = item.payload.subarray(offset, offset + PAGE_SIZE - 4);
        overflowBytes.set(chunk, 4);
        offset += chunk.length;
        if (previous !== 0) {
          new DataView(pages.get(previous)!.buffer).setUint32(0, overflowPage, false);
        }
        pages.set(overflowPage, overflowBytes);
        previous = overflowPage;
      }
    }

    const cell = concat([
      varint(item.payload.length),
      varint(item.rowid),
      item.payload.subarray(0, item.layout.local),
      ...(item.layout.overflow ? [bigEndian32(firstOverflowPage)] : []),
    ]);
    page.addCell(cell, item.rowid);
  }
  pages.set(leaves[leafIndex]!, page.seal(0x0d));
  maxRowids.push(page.lastRowid);

  if (leaves.length === 1) return; // leaf was written directly to the root page

  // Multiple leaves need an interior table b-tree page as the table root.
  const root = new BTreePage(0);
  const cells: Uint8Array[] = [];
  for (let i = 0; i < leaves.length - 1; i++) {
    cells.push(concat([bigEndian32(leaves[i]!), varint(maxRowids[i] ?? 0)]));
  }
  let cursor = PAGE_SIZE;
  const offsets: number[] = [];
  for (const cell of cells.reverse()) {
    cursor -= cell.length;
    root.bytes.set(cell, cursor);
    offsets.unshift(cursor);
  }
  root.bytes[0] = 0x05;
  new DataView(root.bytes.buffer).setUint16(3, cells.length, false);
  new DataView(root.bytes.buffer).setUint16(5, cursor === PAGE_SIZE ? 0 : cursor, false);
  new DataView(root.bytes.buffer).setUint32(8, leaves[leaves.length - 1]!, false);
  offsets.forEach((offset, index) => new DataView(root.bytes.buffer).setUint16(12 + index * 2, offset, false));
  pages.set(rootPage, root.bytes);
}

function escapeHTML(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ankiTags(question: Question): string {
  const tags = [question.topicCode, ...(question.tags ?? [])]
    .map(tag => tag.replace(/\s+/g, '_'))
    .filter(Boolean);
  return ` ${[...new Set(tags)].join(' ')} `;
}

function checksum(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return hash >>> 0;
}

function ankiModels(now: number): Record<string, unknown> {
  return {
    [String(MODEL_ID)]: {
      id: MODEL_ID,
      name: 'CPNS BMKG Basic',
      type: 0,
      mod: now,
      usn: 0,
      sortf: 0,
      did: DECK_BASE,
      tmpls: [{
        id: MODEL_ID + 1,
        name: 'Card 1',
        ord: 0,
        qfmt: '{{Front}}',
        afmt: '{{FrontSide}}<hr id="answer">{{Back}}',
        bqfmt: '',
        bafmt: '',
        did: null,
        bfont: 0,
        bsize: 0,
      }],
      flds: [
        { name: 'Front', ord: 0, sticky: false, rtl: false, font: 'Arial', size: 20, description: '' },
        { name: 'Back', ord: 1, sticky: false, rtl: false, font: 'Arial', size: 20, description: '' },
      ],
      css: '.card { font-family: Arial; font-size: 20px; text-align: center; } .back { font-size: 17px; }',
      latexPre: '',
      latexPost: '',
      latexSvg: false,
      req: [[0, 'any', [0]]],
      tags: [],
      vers: [],
      kind: 'Basic',
    },
  };
}

function ankiDecks(questions: Question[], now: number): { decks: Record<string, unknown>; deckIdFor: (question: Question) => number } {
  const topics = [...new Set(questions.map(q => q.topicCode))].sort();
  const decks: Record<string, unknown> = {};
  topics.forEach((topic, index) => {
    const id = DECK_BASE + index;
    decks[String(id)] = {
      id,
      name: `CPNS::${topic}`,
      usn: 0,
      mod: now,
      collapsed: false,
      conf: 1,
      desc: '',
      dyn: 0,
    };
  });
  const indexByTopic = new Map(topics.map((topic, index) => [topic, DECK_BASE + index]));
  return { decks, deckIdFor: question => indexByTopic.get(question.topicCode) ?? DECK_BASE };
}

const TABLE_SCHEMAS = [
  {
    name: 'col',
    root: 2,
    sql: 'CREATE TABLE col (id INTEGER PRIMARY KEY, crt INTEGER NOT NULL, mod INTEGER NOT NULL, scm INTEGER NOT NULL, ver INTEGER NOT NULL, dty INTEGER NOT NULL, usn INTEGER NOT NULL, ls INTEGER NOT NULL, conf TEXT NOT NULL, models TEXT NOT NULL, decks TEXT NOT NULL, dconf TEXT NOT NULL, tags TEXT NOT NULL)',
  },
  {
    name: 'notes',
    root: 3,
    sql: 'CREATE TABLE notes (id INTEGER PRIMARY KEY, guid TEXT NOT NULL, mid INTEGER NOT NULL, mod INTEGER NOT NULL, usn INTEGER NOT NULL, tags TEXT NOT NULL, flds TEXT NOT NULL, sfld TEXT NOT NULL, csum INTEGER NOT NULL, flags INTEGER NOT NULL, data TEXT NOT NULL)',
  },
  {
    name: 'cards',
    root: 4,
    sql: 'CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER NOT NULL, did INTEGER NOT NULL, ord INTEGER NOT NULL, mod INTEGER NOT NULL, usn INTEGER NOT NULL, type INTEGER NOT NULL, queue INTEGER NOT NULL, due INTEGER NOT NULL, ivl INTEGER NOT NULL, factor INTEGER NOT NULL, reps INTEGER NOT NULL, lapses INTEGER NOT NULL, left INTEGER NOT NULL, odue INTEGER NOT NULL, odid INTEGER NOT NULL, flags INTEGER NOT NULL, data TEXT NOT NULL)',
  },
];

function buildDatabase(questions: Question[]): Uint8Array {
  const now = Math.floor(Date.now() / 1000);
  const { decks, deckIdFor } = ankiDecks(questions, now);
  const pages = new Map<number, Uint8Array>();
  const allocator = new PageAllocator();

  const master: SqlRecord[] = TABLE_SCHEMAS.map((table, index) => ({
    rowid: index + 1,
    values: ['table', table.name, table.name, table.root, table.sql],
  }));
  const masterPage = new BTreePage(100);
  const sortedMaster = [...master].sort((a, b) => a.rowid - b.rowid);
  let masterCursor = PAGE_SIZE;
  for (const record of sortedMaster) {
    const payload = encodeRecord(record.values);
    const cell = concat([varint(payload.length), varint(record.rowid), payload]);
    masterCursor -= cell.length;
    masterPage.bytes.set(cell, masterCursor);
    new DataView(masterPage.bytes.buffer).setUint16(108 + (record.rowid - 1) * 2, masterCursor, false);
  }
  masterPage.bytes[100] = 0x0d;
  new DataView(masterPage.bytes.buffer).setUint16(103, sortedMaster.length, false);
  new DataView(masterPage.bytes.buffer).setUint16(105, masterCursor === PAGE_SIZE ? 0 : masterCursor, false);
  pages.set(1, masterPage.bytes);

  const colValues: SqlValue[] = [
    1, now, now, now, 18, 0, 0, 0,
    JSON.stringify({ nextPos: 1, estTime: 0, currentBranch: 1, oldTime: 0 }),
    JSON.stringify(ankiModels(now)),
    JSON.stringify(decks),
    JSON.stringify({ 1: { id: 1, mod: now, usn: 0, name: 'Default' } }),
    '{}',
  ];
  buildTable([{ rowid: 1, values: colValues }], 2, allocator, pages);

  const noteRecords: SqlRecord[] = [];
  const cardRecords: SqlRecord[] = [];
  questions.forEach((question, index) => {
    const front = escapeHTML(question.stem ?? '');
    const options = (question.options ?? [])
      .map((option, optionIndex) => {
        const letter = String.fromCharCode(65 + optionIndex);
        return `${letter}. ${escapeHTML(option.text ?? '')}${option.isCorrect ? ' ✓' : ''}`;
      })
      .join('<br>');
    const back = `<div>${options}</div>${question.explanation ? `<div><br>${escapeHTML(question.explanation)}</div>` : ''}`;

    const noteId = NOTE_BASE + index;
    const cardId = CARD_BASE + index;
    noteRecords.push({
      rowid: noteId,
      values: [
        noteId,
        `cpns-${question.id}`.replace(/\s+/g, '-'),
        MODEL_ID,
        now,
        0,
        ankiTags(question),
        `${front}\u001f${back}`,
        front,
        checksum(front),
        0,
        '',
      ],
    });
    cardRecords.push({
      rowid: cardId,
      values: [cardId, noteId, deckIdFor(question), 0, now, 0, 0, 0, index + 1, 0, 0, 0, 0, 0, 0, 0, 0, ''],
    });
  });
  buildTable(noteRecords, 3, allocator, pages);
  buildTable(cardRecords, 4, allocator, pages);

  const totalPages = Math.max(...pages.keys());
  const dbBytes = new Uint8Array(totalPages * PAGE_SIZE);
  pages.forEach((page, number) => dbBytes.set(page, (number - 1) * PAGE_SIZE));

  const header = new DataView(dbBytes.buffer);
  const magic = new TextEncoder().encode('SQLite format 3\0');
  dbBytes.set(magic, 0);
  header.setUint16(16, PAGE_SIZE === 65536 ? 1 : PAGE_SIZE, false); // 1 encodes 64 KiB
  header.setUint8(18, 1);
  header.setUint8(19, 1);
  header.setUint8(20, 0); // reserved bytes
  header.setUint8(21, 64);
  header.setUint8(22, 32);
  header.setUint8(23, 32);
  header.setUint32(24, 1, false); // file change counter
  header.setUint32(28, totalPages, false);
  header.setUint32(40, 1, false); // schema cookie
  header.setUint32(44, 4, false); // schema format
  header.setUint32(56, 1, false); // UTF-8 text encoding
  header.setUint32(92, 1, false); // version-valid-for
  header.setUint32(96, 3040000, false); // writer SQLite version
  return dbBytes;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Store-only ZIP writer; Anki accepts uncompressed entries. */
function zipFiles(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true); // stored
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, file.data.length, true);
    localView.setUint32(22, file.data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    localParts.push(local, file.data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, file.data.length, true);
    centralView.setUint32(24, file.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centralParts.push(central);
    offset += local.length + file.data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  return concat([...localParts, ...centralParts, end]);
}

/** Generate a valid Anki 2.1 package with one basic card per question. */
export function generateApkg(questions: readonly Question[]): Uint8Array {
  if (questions.length === 0) throw new Error('Tidak ada soal untuk diekspor ke Anki');
  const collection = buildDatabase([...questions]);
  return zipFiles([
    { name: 'collection.anki2', data: collection },
    { name: 'media', data: new TextEncoder().encode('{}') },
  ]);
}
