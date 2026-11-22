/**
 * Segment-safe JPEG density metadata parser and writer.
 * - Never patches assumed byte offsets; parses SOI -> segments -> SOS cleanly.
 * - Updates existing JFIF APP0 density or inserts a canonical JFIF 1.01 APP0 segment.
 * - Keeps any existing EXIF APP1 resolution tags consistent in-place.
 * - Preserves entropy-coded scan bytes (SOS..EOF) untouched without recompression.
 */

function readU16BE(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function writeU16BE(bytes, offset, val) {
  bytes[offset] = (val >>> 8) & 0xff;
  bytes[offset + 1] = val & 0xff;
}

function readU16(bytes, offset, littleEndian) {
  return littleEndian
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : (bytes[offset] << 8) | bytes[offset + 1];
}

function readU32(bytes, offset, littleEndian) {
  if (littleEndian) {
    return (
      (bytes[offset]) |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)
    ) >>> 0;
  }
  return (
    (bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    (bytes[offset + 3])
  ) >>> 0;
}

function writeU16(bytes, offset, val, littleEndian) {
  if (littleEndian) {
    bytes[offset] = val & 0xff;
    bytes[offset + 1] = (val >>> 8) & 0xff;
  } else {
    bytes[offset] = (val >>> 8) & 0xff;
    bytes[offset + 1] = val & 0xff;
  }
}

function writeU32(bytes, offset, val, littleEndian) {
  if (littleEndian) {
    bytes[offset] = val & 0xff;
    bytes[offset + 1] = (val >>> 8) & 0xff;
    bytes[offset + 2] = (val >>> 16) & 0xff;
    bytes[offset + 3] = (val >>> 24) & 0xff;
  } else {
    bytes[offset] = (val >>> 24) & 0xff;
    bytes[offset + 1] = (val >>> 16) & 0xff;
    bytes[offset + 2] = (val >>> 8) & 0xff;
    bytes[offset + 3] = val & 0xff;
  }
}

function isJfifPayload(payload) {
  return (
    payload.length >= 14 &&
    payload[0] === 0x4a && // J
    payload[1] === 0x46 && // F
    payload[2] === 0x49 && // I
    payload[3] === 0x46 && // F
    payload[4] === 0x00
  );
}

function isExifPayload(payload) {
  return (
    payload.length >= 14 &&
    payload[0] === 0x45 && // E
    payload[1] === 0x78 && // x
    payload[2] === 0x69 && // i
    payload[3] === 0x66 && // f
    payload[4] === 0x00 &&
    payload[5] === 0x00
  );
}

function isSofMarker(marker) {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

function hasStandaloneNoLength(marker) {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8);
}

function buildCanonicalJfifPayload(xDpi, yDpi) {
  const payload = new Uint8Array(14);
  payload[0] = 0x4a; // J
  payload[1] = 0x46; // F
  payload[2] = 0x49; // I
  payload[3] = 0x46; // F
  payload[4] = 0x00;
  payload[5] = 1; // Major 1
  payload[6] = 1; // Minor 1
  payload[7] = 1; // Units: dots per inch
  writeU16BE(payload, 8, xDpi);
  writeU16BE(payload, 10, yDpi);
  payload[12] = 0; // Xthumbnail
  payload[13] = 0; // Ythumbnail
  return payload;
}

function inspectAndMaybeUpdateExif(payload, targetDpi = null) {
  const result = {
    found: true,
    xResolution: null,
    yResolution: null,
    resolutionUnit: null,
    orientation: null,
  };
  const tiffStart = 6;
  if (payload.length < tiffStart + 8) return result;

  let littleEndian;
  if (payload[tiffStart] === 0x49 && payload[tiffStart + 1] === 0x49) {
    littleEndian = true;
  } else if (payload[tiffStart] === 0x4d && payload[tiffStart + 1] === 0x4d) {
    littleEndian = false;
  } else {
    return result;
  }

  if (readU16(payload, tiffStart + 2, littleEndian) !== 42) return result;
  const ifd0Offset = readU32(payload, tiffStart + 4, littleEndian);
  const ifd0Pos = tiffStart + ifd0Offset;
  if (ifd0Pos + 2 > payload.length) return result;

  const entryCount = readU16(payload, ifd0Pos, littleEndian);
  for (let i = 0; i < entryCount; i += 1) {
    const entryOffset = ifd0Pos + 2 + i * 12;
    if (entryOffset + 12 > payload.length) break;

    const tag = readU16(payload, entryOffset, littleEndian);
    const type = readU16(payload, entryOffset + 2, littleEndian);
    const count = readU32(payload, entryOffset + 4, littleEndian);

    if (tag === 0x0112 && type === 3 && count === 1) {
      result.orientation = readU16(payload, entryOffset + 8, littleEndian);
    } else if (tag === 0x0128 && type === 3 && count === 1) {
      if (targetDpi !== null) {
        writeU16(payload, entryOffset + 8, 2, littleEndian); // 2 = inches
      }
      result.resolutionUnit = readU16(payload, entryOffset + 8, littleEndian);
    } else if ((tag === 0x011a || tag === 0x011b) && type === 5 && count === 1) {
      const valRelOffset = readU32(payload, entryOffset + 8, littleEndian);
      const valPos = tiffStart + valRelOffset;
      if (valPos + 8 <= payload.length) {
        if (targetDpi !== null) {
          writeU32(payload, valPos, targetDpi.x, littleEndian);
          writeU32(payload, valPos + 4, 1, littleEndian);
        }
        const num = readU32(payload, valPos, littleEndian);
        const den = readU32(payload, valPos + 4, littleEndian);
        const ratio = den > 0 ? num / den : null;
        if (tag === 0x011a) result.xResolution = ratio;
        else result.yResolution = ratio;
      }
    }
  }

  return result;
}

function parseHeaderSegments(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4) {
    throw new Error('Invalid JPEG buffer: too short.');
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('Invalid JPEG header: missing SOI marker.');
  }

  const segments = [];
  let pos = 2;
  let scanOffset = bytes.length;

  while (pos < bytes.length) {
    if (bytes[pos] !== 0xff) {
      throw new Error(`Invalid JPEG marker alignment at byte ${pos}.`);
    }
    while (pos < bytes.length && bytes[pos] === 0xff) {
      pos += 1;
    }
    if (pos >= bytes.length) break;

    const marker = bytes[pos];
    pos += 1;

    if (marker === 0xda || marker === 0xd9) {
      // SOS (0xDA) or premature EOI (0xD9): preserve exact start of marker bytes through EOF
      scanOffset = pos - 2;
      break;
    }

    if (hasStandaloneNoLength(marker)) {
      segments.push({ marker, payload: null });
      continue;
    }

    if (pos + 2 > bytes.length) {
      throw new Error(`Truncated JPEG segment length for marker 0x${marker.toString(16)}.`);
    }
    const segLen = readU16BE(bytes, pos);
    if (segLen < 2 || pos + segLen > bytes.length) {
      throw new Error(`Corrupt JPEG segment length (${segLen}) for marker 0x${marker.toString(16)}.`);
    }

    const payload = bytes.slice(pos + 2, pos + segLen);
    segments.push({ marker, payload });
    pos += segLen;
  }

  return { segments, tail: bytes.subarray(scanOffset) };
}

export function setJpegDpi(jpegBytes, xDpi = 300, yDpi = xDpi) {
  if (!Number.isInteger(xDpi) || xDpi < 1 || xDpi > 65535 || !Number.isInteger(yDpi) || yDpi < 1 || yDpi > 65535) {
    throw new Error('DPI must be an integer between 1 and 65535.');
  }

  const { segments, tail } = parseHeaderSegments(jpegBytes);
  const outSegments = [];
  let wroteJfif = false;

  for (const seg of segments) {
    if (seg.marker === 0xe0 && seg.payload && isJfifPayload(seg.payload)) {
      if (wroteJfif) {
        // Drop duplicate JFIF APP0 blocks so metadata never conflicts
        continue;
      }
      const nextPayload = seg.payload.slice();
      nextPayload[7] = 1; // dots per inch
      writeU16BE(nextPayload, 8, xDpi);
      writeU16BE(nextPayload, 10, yDpi);
      outSegments.push({ marker: 0xe0, payload: nextPayload });
      wroteJfif = true;
      continue;
    }

    if (seg.marker === 0xe1 && seg.payload && isExifPayload(seg.payload)) {
      const nextPayload = seg.payload.slice();
      inspectAndMaybeUpdateExif(nextPayload, { x: xDpi, y: yDpi });
      outSegments.push({ marker: 0xe1, payload: nextPayload });
      continue;
    }

    outSegments.push(seg);
  }

  if (!wroteJfif) {
    outSegments.unshift({
      marker: 0xe0,
      payload: buildCanonicalJfifPayload(xDpi, yDpi),
    });
  }

  let totalLen = 2 + tail.length;
  for (const seg of outSegments) {
    totalLen += seg.payload === null ? 2 : 4 + seg.payload.length;
  }

  const out = new Uint8Array(totalLen);
  out[0] = 0xff;
  out[1] = 0xd8;
  let offset = 2;

  for (const seg of outSegments) {
    out[offset] = 0xff;
    out[offset + 1] = seg.marker;
    if (seg.payload === null) {
      offset += 2;
    } else {
      writeU16BE(out, offset + 2, seg.payload.length + 2);
      out.set(seg.payload, offset + 4);
      offset += 4 + seg.payload.length;
    }
  }

  out.set(tail, offset);
  return out;
}

export function readJpegMetadata(jpegBytes) {
  const metadata = {
    valid: false,
    jfif: { found: false, count: 0, units: null, xDensity: null, yDensity: null },
    exif: { found: false, xResolution: null, yResolution: null, resolutionUnit: null, orientation: null },
    sof: { found: false, marker: null, width: null, height: null },
    hasEoi: false,
  };

  try {
    const { segments, tail } = parseHeaderSegments(jpegBytes);
    metadata.valid = true;

    for (const seg of segments) {
      if (seg.marker === 0xe0 && seg.payload && isJfifPayload(seg.payload)) {
        metadata.jfif.count += 1;
        if (!metadata.jfif.found) {
          metadata.jfif.found = true;
          metadata.jfif.units = seg.payload[7];
          metadata.jfif.xDensity = readU16BE(seg.payload, 8);
          metadata.jfif.yDensity = readU16BE(seg.payload, 10);
        }
      } else if (seg.marker === 0xe1 && seg.payload && isExifPayload(seg.payload)) {
        const exifInfo = inspectAndMaybeUpdateExif(seg.payload, null);
        if (!metadata.exif.found) {
          metadata.exif = exifInfo;
        }
      } else if (isSofMarker(seg.marker) && seg.payload && seg.payload.length >= 5) {
        metadata.sof = {
          found: true,
          marker: seg.marker,
          height: readU16BE(seg.payload, 1),
          width: readU16BE(seg.payload, 3),
        };
      }
    }

    let end = jpegBytes.length;
    while (end > 2 && jpegBytes[end - 1] === 0x00) {
      end -= 1;
    }
    metadata.hasEoi = tail.length >= 2 && end >= 2 && jpegBytes[end - 2] === 0xff && jpegBytes[end - 1] === 0xd9;
    return metadata;
  } catch {
    return metadata;
  }
}
