/**
 * Zero-dependency STORE-mode (method 0) ZIP archive writer and independent reader.
 * Ideal for JPEGs which are already compressed and gain virtually nothing from DEFLATE.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosTimeDate(date = new Date()) {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  return { dosTime, dosDate };
}

export function createStoreZip(entries) {
  const encoder = new TextEncoder();
  const prepared = [];
  let localSectionSize = 0;
  let centralDirSize = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
    const crc = crc32(data);
    const { dosTime, dosDate } = toDosTimeDate(entry.date);

    prepared.push({
      nameBytes,
      data,
      crc,
      dosTime,
      dosDate,
      localOffset: localSectionSize,
    });

    localSectionSize += 30 + nameBytes.length + data.length;
    centralDirSize += 46 + nameBytes.length;
  }

  const totalSize = localSectionSize + centralDirSize + 22;
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);
  let pos = 0;

  // Local file headers + data
  for (const item of prepared) {
    view.setUint32(pos, 0x04034b50, true); // Local file header sig
    view.setUint16(pos + 4, 20, true); // Version needed (2.0)
    view.setUint16(pos + 6, 0x0800, true); // UTF-8 filename flag
    view.setUint16(pos + 8, 0, true); // Compression: STORE (0)
    view.setUint16(pos + 10, item.dosTime, true);
    view.setUint16(pos + 12, item.dosDate, true);
    view.setUint32(pos + 14, item.crc, true);
    view.setUint32(pos + 18, item.data.length, true); // Compressed size
    view.setUint32(pos + 22, item.data.length, true); // Uncompressed size
    view.setUint16(pos + 26, item.nameBytes.length, true);
    view.setUint16(pos + 28, 0, true); // Extra field length
    out.set(item.nameBytes, pos + 30);
    out.set(item.data, pos + 30 + item.nameBytes.length);
    pos += 30 + item.nameBytes.length + item.data.length;
  }

  const cdStart = pos;

  // Central directory headers
  for (const item of prepared) {
    view.setUint32(pos, 0x02014b50, true); // Central directory sig
    view.setUint16(pos + 4, 20, true); // Version made by
    view.setUint16(pos + 6, 20, true); // Version needed
    view.setUint16(pos + 8, 0x0800, true); // UTF-8 flag
    view.setUint16(pos + 10, 0, true); // Method: STORE
    view.setUint16(pos + 12, item.dosTime, true);
    view.setUint16(pos + 14, item.dosDate, true);
    view.setUint32(pos + 16, item.crc, true);
    view.setUint32(pos + 20, item.data.length, true);
    view.setUint32(pos + 24, item.data.length, true);
    view.setUint16(pos + 28, item.nameBytes.length, true);
    view.setUint16(pos + 30, 0, true); // Extra length
    view.setUint16(pos + 32, 0, true); // Comment length
    view.setUint16(pos + 34, 0, true); // Disk number start
    view.setUint16(pos + 36, 0, true); // Internal attrs
    view.setUint32(pos + 38, 0, true); // External attrs
    view.setUint32(pos + 42, item.localOffset, true);
    out.set(item.nameBytes, pos + 46);
    pos += 46 + item.nameBytes.length;
  }

  // End of Central Directory (EOCD)
  view.setUint32(pos, 0x06054b50, true);
  view.setUint16(pos + 4, 0, true);
  view.setUint16(pos + 6, 0, true);
  view.setUint16(pos + 8, prepared.length, true);
  view.setUint16(pos + 10, prepared.length, true);
  view.setUint32(pos + 12, centralDirSize, true);
  view.setUint32(pos + 16, cdStart, true);
  view.setUint16(pos + 20, 0, true);

  return out;
}

/**
 * Independent STORE-mode ZIP reader for validation and testing.
 */
export function parseZipEntries(zipBytes) {
  const bytes = zipBytes instanceof Uint8Array ? zipBytes : new Uint8Array(zipBytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();

  let eocdPos = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos < 0) {
    throw new Error('Invalid ZIP: EOCD record not found.');
  }

  const totalEntries = view.getUint16(eocdPos + 10, true);
  const cdOffset = view.getUint32(eocdPos + 16, true);
  const entries = [];
  let cdPos = cdOffset;

  for (let i = 0; i < totalEntries; i += 1) {
    if (view.getUint32(cdPos, true) !== 0x02014b50) {
      throw new Error(`Invalid ZIP central directory signature at ${cdPos}.`);
    }
    const method = view.getUint16(cdPos + 10, true);
    const expectedCrc = view.getUint32(cdPos + 16, true);
    const compSize = view.getUint32(cdPos + 20, true);
    const uncompSize = view.getUint32(cdPos + 24, true);
    const nameLen = view.getUint16(cdPos + 28, true);
    const extraLen = view.getUint16(cdPos + 30, true);
    const commentLen = view.getUint16(cdPos + 32, true);
    const localOffset = view.getUint32(cdPos + 42, true);
    const name = decoder.decode(bytes.subarray(cdPos + 46, cdPos + 46 + nameLen));

    if (view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error(`Invalid local file header for "${name}".`);
    }
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = bytes.slice(dataStart, dataStart + compSize);

    if (method !== 0 || compSize !== uncompSize) {
      throw new Error(`Unsupported compression or size mismatch for "${name}".`);
    }
    const actualCrc = crc32(data);
    if (actualCrc !== expectedCrc) {
      throw new Error(`CRC-32 mismatch for "${name}": expected ${expectedCrc}, got ${actualCrc}.`);
    }

    entries.push({ name, data, crc32: actualCrc, size: data.length });
    cdPos += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}
