const decoder = new TextDecoder('latin1');
// TextDecoder rejects views backed by growable WebAssembly shared memory in Chromium.
export const textAt = (bytes, start, length) =>
  decoder.decode(new Uint8Array(bytes.subarray(start, start + length)));
export const viewOf = (bytes) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
export function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
export function sniff(bytes) {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (bytes[0] === 137 && textAt(bytes, 1, 3) === 'PNG') return 'png';
  if (textAt(bytes, 0, 4) === 'RIFF' && textAt(bytes, 8, 4) === 'WEBP')
    return 'webp';
  if (['II*\0', 'MM\0*', 'II+\0', 'MM\0+'].includes(textAt(bytes, 0, 4)))
    return 'tiff';
  if (textAt(bytes, 4, 4) === 'ftyp') {
    const brands = textAt(bytes, 8, Math.min(40, bytes.length - 8));
    if (brands.includes('crx ')) return 'cr3';
    if (/avif|avis/.test(brands)) return 'avif';
    if (/heic|heix|hevc|hevx|mif1/.test(brands)) return 'heic';
  }
  return null;
}
export function jpegSegments(bytes) {
  if (sniff(bytes) !== 'jpg')
    throw new Error('JPEG 시그니처가 올바르지 않습니다.');
  const segments = [];
  const v = viewOf(bytes);
  let p = 2;
  while (p < bytes.length) {
    const start = p;
    if (bytes[p++] !== 255) throw new Error('손상된 JPEG 마커입니다.');
    while (bytes[p] === 255) p++;
    const marker = bytes[p++];
    if (marker === 0xda || marker === 0xd9)
      return { segments, tail: bytes.subarray(start) };
    if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) {
      segments.push({
        marker,
        bytes: bytes.subarray(start, p),
        data: new Uint8Array(),
      });
      continue;
    }
    if (p + 2 > bytes.length) throw new Error('잘린 JPEG 헤더입니다.');
    const length = v.getUint16(p);
    if (length < 2 || p + length > bytes.length)
      throw new Error('JPEG 세그먼트 범위가 올바르지 않습니다.');
    segments.push({
      marker,
      bytes: bytes.subarray(start, p + length),
      data: bytes.subarray(p + 2, p + length),
    });
    p += length;
  }
  throw new Error('JPEG 이미지 데이터가 없습니다.');
}
export function jpegDimensions(bytes) {
  for (const seg of jpegSegments(bytes).segments) {
    if ([0xc0, 0xc1, 0xc2].includes(seg.marker) && seg.data.length >= 6) {
      const v = viewOf(seg.data);
      return { width: v.getUint16(3), height: v.getUint16(1) };
    }
  }
  throw new Error('JPEG 해상도를 읽을 수 없습니다.');
}
export function rewriteJpeg(bytes, exif) {
  const clean = [];
  for (const s of jpegParts(bytes)) {
    if (s.marker >= 0xe0 && s.marker <= 0xef) {
      if (s.marker === 0xe2 && textAt(s.data, 0, 12) === 'ICC_PROFILE\0')
        clean.push(s.bytes);
      else if (s.marker === 0xee && textAt(s.data, 0, 5) === 'Adobe')
        clean.push(s.bytes);
      else if (
        s.marker === 0xe0 &&
        textAt(s.data, 0, 5) === 'JFIF\0' &&
        s.data.length >= 14
      ) {
        const jfif = new Uint8Array(18);
        jfif.set([255, 224, 0, 16]);
        jfif.set(s.data.subarray(0, 14), 4);
        jfif[16] = 0;
        jfif[17] = 0;
        clean.push(jfif);
      }
    } else if (s.marker !== 0xfe) clean.push(s.bytes);
  }
  if (exif?.length) {
    if (exif.length > 65533)
      throw new Error('EXIF 데이터가 JPEG 한도를 초과합니다.');
    const header = new Uint8Array([255, 225, 0, 0]);
    viewOf(header).setUint16(2, exif.length + 2);
    clean.unshift(concat([header, exif]));
  }
  return concat([bytes.subarray(0, 2), ...clean]);
}

// Walk scan entropy as well as headers: APP/COM blocks may legally occur between scans.
// Bytes after EOI are deliberately excluded, including arbitrary appended metadata.
export function jpegParts(bytes) {
  if (sniff(bytes) !== 'jpg')
    throw new Error('JPEG 시그니처가 올바르지 않습니다.');
  const parts = [],
    v = viewOf(bytes);
  let p = 2;
  while (p < bytes.length) {
    const start = p;
    if (bytes[p++] !== 255) throw new Error('손상된 JPEG 마커입니다.');
    while (bytes[p] === 255) p++;
    const marker = bytes[p++];
    if (marker === 0xd9) {
      parts.push({
        marker,
        bytes: bytes.subarray(start, p),
        data: new Uint8Array(),
      });
      return parts;
    }
    if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push({
        marker,
        bytes: bytes.subarray(start, p),
        data: new Uint8Array(),
      });
      continue;
    }
    if (p + 2 > bytes.length) throw new Error('잘린 JPEG 세그먼트입니다.');
    const length = v.getUint16(p);
    if (length < 2 || p + length > bytes.length)
      throw new Error('JPEG 세그먼트 범위가 올바르지 않습니다.');
    parts.push({
      marker,
      bytes: bytes.subarray(start, p + length),
      data: bytes.subarray(p + 2, p + length),
    });
    p += length;
    if (marker === 0xda) {
      const scan = p;
      while (p < bytes.length) {
        if (bytes[p] !== 255) {
          p++;
          continue;
        }
        let next = p + 1;
        while (bytes[next] === 255) next++;
        if (bytes[next] === 0 || (bytes[next] >= 0xd0 && bytes[next] <= 0xd7)) {
          p = next + 1;
          continue;
        }
        break;
      }
      parts.push({
        marker: 0,
        bytes: bytes.subarray(scan, p),
        data: new Uint8Array(),
      });
    }
  }
  throw new Error('JPEG 종료 마커가 없습니다.');
}
export async function containerIcc(bytes) {
  if (sniff(bytes) === 'jpg') {
    const parts = jpegSegments(bytes).segments.filter(
      (s) => s.marker === 0xe2 && textAt(s.data, 0, 12) === 'ICC_PROFILE\0',
    );
    if (!parts.length) return null;
    const count = parts[0].data[13];
    if (!count || parts.length !== count)
      throw new Error('ICC JPEG 세그먼트가 누락되었습니다.');
    parts.sort((a, b) => a.data[12] - b.data[12]);
    if (parts.some((p, i) => p.data[12] !== i + 1 || p.data[13] !== count))
      throw new Error('ICC JPEG 세그먼트 순서가 올바르지 않습니다.');
    return concat(parts.map((p) => p.data.subarray(14)));
  }
  if (sniff(bytes) === 'webp')
    return webpChunks(bytes).find((c) => c.type === 'ICCP')?.data || null;
  if (sniff(bytes) === 'png') {
    let pos = 8;
    while (pos + 12 <= bytes.length) {
      const size = viewOf(bytes).getUint32(pos);
      if (pos + size + 12 > bytes.length)
        throw new Error('잘린 PNG 청크입니다.');
      if (textAt(bytes, pos + 4, 4) === 'iCCP') {
        const payload = bytes.subarray(pos + 8, pos + 8 + size),
          zero = payload.indexOf(0);
        if (zero < 1 || zero > 79 || payload[zero + 1] !== 0)
          throw new Error('PNG ICC 헤더가 손상되었습니다.');
        const reader = new Blob([new Uint8Array(payload.subarray(zero + 2))])
          .stream()
          .pipeThrough(new DecompressionStream('deflate'))
          .getReader();
        const chunks = [];
        let length = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            length += value.length;
            if (length > 16 * 1024 * 1024)
              throw new Error('ICC 프로파일 크기 한도를 초과합니다.');
            chunks.push(value);
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        return concat(chunks);
      }
      pos += size + 12;
    }
  }
  return null;
}
export function webpChunks(bytes) {
  if (
    sniff(bytes) !== 'webp' ||
    bytes.length < 20 ||
    viewOf(bytes).getUint32(4, true) + 8 !== bytes.length
  )
    throw new Error('손상된 WebP 컨테이너입니다.');
  const chunks = [];
  let p = 12;
  while (p < bytes.length) {
    if (p + 8 > bytes.length) throw new Error('잘린 WebP 청크입니다.');
    const size = viewOf(bytes).getUint32(p + 4, true),
      end = p + 8 + size;
    if (end + (size % 2) > bytes.length)
      throw new Error('WebP 청크 범위가 올바르지 않습니다.');
    chunks.push({
      type: textAt(bytes, p, 4),
      data: bytes.subarray(p + 8, end),
    });
    p = end + (size % 2);
  }
  return chunks;
}
function chunk(type, data) {
  const head = new Uint8Array(8);
  head.set(new TextEncoder().encode(type));
  viewOf(head).setUint32(4, data.length, true);
  return concat([head, data, new Uint8Array(data.length % 2)]);
}
export function rewriteWebp(bytes, exif, width, height, hasAlpha = false) {
  const chunks = webpChunks(bytes).filter(
    (c) => !['EXIF', 'XMP ', 'VP8X'].includes(c.type),
  );
  if (chunks.some((c) => c.type === 'ANIM' || c.type === 'ANMF'))
    throw new Error('애니메이션 WebP는 지원하지 않습니다.');
  const flags =
    (chunks.some((c) => c.type === 'ICCP') ? 32 : 0) |
    (hasAlpha ? 16 : 0) |
    (exif?.length ? 8 : 0);
  const extended = new Uint8Array(10);
  extended[0] = flags;
  for (let i = 0; i < 3; i++) {
    extended[4 + i] = ((width - 1) >>> (8 * i)) & 255;
    extended[7 + i] = ((height - 1) >>> (8 * i)) & 255;
  }
  const body = [
    chunk('VP8X', extended),
    ...chunks.map((c) => chunk(c.type, c.data)),
  ];
  if (exif?.length) body.push(chunk('EXIF', exif));
  const result = concat([
    new TextEncoder().encode('RIFF\0\0\0\0WEBP'),
    ...body,
  ]);
  viewOf(result).setUint32(4, result.length - 8, true);
  return result;
}
export function metadataContainers(bytes) {
  const format = sniff(bytes);
  if (format === 'jpg')
    return jpegParts(bytes)
      .filter((s) => [0xe1, 0xed, 0xfe].includes(s.marker))
      .map((s) => (textAt(s.data, 0, 6) === 'Exif\0\0' ? 'exif' : 'other'));
  if (format === 'webp')
    return webpChunks(bytes)
      .filter((c) => ['EXIF', 'XMP '].includes(c.type))
      .map((c) => (c.type === 'EXIF' ? 'exif' : 'other'));
  if (format === 'png') {
    const found = [];
    let p = 8;
    while (p + 12 <= bytes.length) {
      const size = viewOf(bytes).getUint32(p),
        type = textAt(bytes, p + 4, 4);
      if (p + 12 + size > bytes.length) throw new Error('잘린 PNG 청크입니다.');
      if (['eXIf', 'iTXt', 'tEXt', 'zTXt'].includes(type))
        found.push(type === 'eXIf' ? 'exif' : 'other');
      p += 12 + size;
    }
    return found;
  }
  return []; // AVIF is additionally checked through the decoded engine's metadata fields.
}
