import zlib from 'node:zlib';

/**
 * Read named members out of a zip, using only node:zlib.
 *
 * Shared because two upstreams now ship zipped archives: NOAA publishes an
 * .xlsx, which is a zip of XML, and AIST publishes a .zip of CSV. They are
 * the same container and this is the same reader. It lives here rather than
 * beside either fetcher so there is one copy to be right -- the lesson from
 * three copies of the completeness scorer, one of which was never called.
 *
 * The central directory is the authority on sizes -- a local header may defer
 * them to a trailing data descriptor, so reading sizes from the local header
 * alone silently truncates entries written by some producers.
 */
export function unzip(buf, wanted) {
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66_000; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip: no end-of-central-directory record');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt central directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const fnLen = buf.readUInt16LE(p + 28);
    const exLen = buf.readUInt16LE(p + 30);
    const cmLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + fnLen);
    p += 46 + fnLen + exLen + cmLen;

    if (!wanted.includes(name)) continue;
    const lFnLen = buf.readUInt16LE(local + 26);
    const lExLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lFnLen + lExLen;
    const raw = buf.subarray(start, start + csize);
    out.set(name, method === 0 ? raw : zlib.inflateRawSync(raw));
  }
  for (const w of wanted) if (!out.has(w)) throw new Error(`missing from workbook: ${w}`);
  return out;
}
