import { createHash } from 'node:crypto';

/**
 * Minimal in-memory ZIP writer (STORE method only, no compression) — just
 * enough to build tiny fixture archives for `skills-import.test.ts` without
 * adding a zip-writing dependency. Not a general-purpose zip library: no
 * compression, no zip64, no unicode flag handling beyond UTF-8 filenames.
 */

export interface ZipEntryInput {
  name: string;
  content: string | Buffer;
  /** Set true to mark this entry as a Unix symlink (S_IFLNK) in the external
   *  file attributes, mirroring how real archivers store symlinks. */
  isSymlink?: boolean;
}

function crc32(buf: Buffer): number {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return ~crc >>> 0;
}

function dosDateTime(): { date: number; time: number } {
  // Fixed arbitrary date — content doesn't depend on it.
  return { date: 0x0021, time: 0x0000 };
}

export function buildZip(entries: ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const { date, time } = dosDateTime();

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const contentBuf = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content, 'utf8');
    const crc = crc32(contentBuf);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // local file header signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(0, 8); // method = 0 (store)
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(contentBuf.length, 18); // compressed size
    localHeader.writeUInt32LE(contentBuf.length, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length

    localParts.push(localHeader, nameBuf, contentBuf);

    const localOffset = offset;
    offset += localHeader.length + nameBuf.length + contentBuf.length;

    // Unix mode in the upper 16 bits of externalFileAttributes.
    // Regular file: 0o100644 << 16. Symlink: 0o120000 (S_IFLNK) << 16.
    const unixMode = entry.isSymlink ? 0o120000 : 0o100644;
    const externalAttrs = (unixMode << 16) >>> 0;

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // central dir signature
    centralHeader.writeUInt16LE(20, 4); // version made by (Unix-ish, doesn't matter for our reader)
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // flags
    centralHeader.writeUInt16LE(0, 10); // method
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(contentBuf.length, 20);
    centralHeader.writeUInt32LE(contentBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra field length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal file attrs
    centralHeader.writeUInt32LE(externalAttrs, 38);
    centralHeader.writeUInt32LE(localOffset, 42);

    centralParts.push(centralHeader, nameBuf);
  }

  const centralDirOffset = offset;
  const centralDir = Buffer.concat(centralParts);
  offset += centralDir.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralDir.length, 12); // central dir size
  eocd.writeUInt32LE(centralDirOffset, 16); // central dir offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, centralDir, eocd]);
}

/** Sanity helper for tests that just want a hash to compare, not the content. */
export function sha1(content: string): string {
  return createHash('sha1').update(content).digest('hex');
}
