import { sniff, textAt, viewOf, jpegDimensions } from './containers.js';

function safeNumber(value) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('컨테이너 오프셋이 너무 큽니다.');
  return Number(value);
}

/** Bounded ISO-BMFF walker: follows structures, never carves arbitrary JPEG markers. */
export function extractCr3(bytes) {
  if (sniff(bytes) !== 'cr3') throw new Error('Canon CR3 파일이 아닙니다.');
  const candidates = [],
    metadata = [],
    v = viewOf(bytes);
  let visited = 0;
  const add = (start, size) => {
    if (start < 0 || size < 4 || start + size > bytes.length)
      throw new Error('CR3 JPEG 범위가 올바르지 않습니다.');
    const data = bytes.subarray(start, start + size);
    if (sniff(data) !== 'jpg') return;
    try {
      candidates.push({ data, ...jpegDimensions(data) });
    } catch {
      /* Other tracks are not JPEG. */
    }
  };
  function walk(start, end, depth = 0, track = null) {
    if (depth > 16) throw new Error('CR3 컨테이너 중첩 한도를 초과합니다.');
    let p = start;
    while (p + 8 <= end) {
      if (++visited > 50000) throw new Error('CR3 컨테이너가 너무 복잡합니다.');
      let size = v.getUint32(p),
        head = 8;
      const type = textAt(bytes, p + 4, 4);
      if (size === 1) {
        if (p + 16 > end) throw new Error('잘린 CR3 확장 헤더입니다.');
        size = safeNumber(v.getBigUint64(p + 8));
        head = 16;
      }
      if (size === 0) size = end - p;
      if (size < head || p + size > end)
        throw new Error('CR3 박스 범위가 올바르지 않습니다.');
      const data = p + head,
        stop = p + size;
      if (type === 'trak') {
        const current = { offsets: [], sizes: [], mapping: [] };
        walk(data, stop, depth + 1, current);
        let sample = 0;
        for (let c = 0; c < current.offsets.length; c++) {
          const entry = [...current.mapping]
            .reverse()
            .find((e) => e.first <= c + 1);
          let offset = current.offsets[c];
          for (
            let s = 0;
            s < (entry?.count || 1) && sample < current.sizes.length;
            s++, sample++
          ) {
            add(offset, current.sizes[sample]);
            offset += current.sizes[sample];
          }
        }
      } else if (['moov', 'mdia', 'minf', 'stbl'].includes(type))
        walk(data, stop, depth + 1, track);
      else if (type === 'uuid' && size >= head + 16) {
        const uuid = [...bytes.subarray(data, data + 16)]
          .map((n) => n.toString(16).padStart(2, '0'))
          .join('');
        if (
          [
            '85c0b687820f11e08111f4ce462b6a48',
            '5766b829bb6a47c5bcfb8b9f2260d06d',
            '210f1687914911e4811100242131fce4',
          ].includes(uuid)
        )
          walk(data + 16, stop, depth + 1, track);
        if (uuid === 'eaf42b5e1c984b88b9fbb7dc406e4d16')
          walk(data + 24, stop, depth + 1, track);
      } else if (type === 'PRVW' && data + 16 <= stop)
        add(data + 16, v.getUint32(data + 12));
      else if (['CMT1', 'CMT2', 'CMT4'].includes(type))
        metadata.push({
          bytes: bytes.slice(data, stop),
          isGps: type === 'CMT4',
        });
      else if (track && ['co64', 'stco', 'stsz', 'stsc'].includes(type)) {
        if (data + 8 > stop) throw new Error('잘린 CR3 트랙입니다.');
        const count = v.getUint32(data + (type === 'stsz' ? 8 : 4));
        if (count > 1000000)
          throw new Error('CR3 트랙 항목 한도를 초과합니다.');
        const stride = type === 'co64' ? 8 : type === 'stsc' ? 12 : 4;
        const base = data + (type === 'stsz' ? 12 : 8);
        const fixed = type === 'stsz' ? v.getUint32(data + 4) : 0;
        if (base + (fixed ? 0 : count * stride) > stop)
          throw new Error('CR3 트랙 테이블 범위가 올바르지 않습니다.');
        for (let i = 0; i < count; i++) {
          if (type === 'stsc')
            track.mapping.push({
              first: v.getUint32(base + i * stride),
              count: v.getUint32(base + i * stride + 4),
            });
          else if (type === 'stsz')
            track.sizes.push(fixed || v.getUint32(base + i * stride));
          else
            track.offsets.push(
              type === 'co64'
                ? safeNumber(v.getBigUint64(base + i * stride))
                : v.getUint32(base + i * stride),
            );
        }
      }
      p = stop;
    }
  }
  walk(0, bytes.length);
  candidates.sort((a, b) => b.width * b.height - a.width * a.height);
  if (!candidates.length)
    throw new Error(
      '이 CR3에서 지원하는 내장 JPEG를 찾을 수 없습니다. JPG/TIFF 보정본을 사용하세요.',
    );
  return { bytes: candidates[0].data, metadata };
}

/** TIFF/DNG IFDs: JPEGInterchangeFormat or JPEG-compressed strip, including SubIFDs. */
export function extractDng(bytes) {
  const v = viewOf(bytes),
    le = textAt(bytes, 0, 2) === 'II';
  if (bytes.length < 8 || v.getUint16(2, le) !== 42)
    throw new Error('지원하지 않는 DNG TIFF 구조입니다.');
  const visited = new Set(),
    candidates = [];
  const scalar = (tag, p, type, count) => {
    const sizes = { 3: 2, 4: 4, 13: 4 },
      unit = sizes[type];
    if (!unit || count > 10000) return [];
    const offset = count * unit <= 4 ? p + 8 : v.getUint32(p + 8, le);
    if (offset + count * unit > bytes.length)
      throw new Error(`잘린 DNG 태그: ${tag}`);
    return Array.from({ length: count }, (_, i) =>
      unit === 2
        ? v.getUint16(offset + i * unit, le)
        : v.getUint32(offset + i * unit, le),
    );
  };
  function ifd(offset, depth = 0) {
    if (!offset || visited.has(offset)) return;
    if (depth > 16 || visited.size > 1000 || offset + 2 > bytes.length)
      throw new Error('DNG IFD 범위가 올바르지 않습니다.');
    visited.add(offset);
    const n = v.getUint16(offset, le),
      tags = {};
    if (offset + 2 + n * 12 + 4 > bytes.length)
      throw new Error('잘린 DNG IFD입니다.');
    for (let i = 0; i < n; i++) {
      const p = offset + 2 + i * 12,
        tag = v.getUint16(p, le);
      tags[tag] = scalar(
        tag,
        p,
        v.getUint16(p + 2, le),
        v.getUint32(p + 4, le),
      );
    }
    const start =
      tags[513]?.[0] ?? (tags[259]?.[0] === 7 ? tags[273]?.[0] : undefined);
    const size =
      tags[514]?.[0] ??
      (tags[259]?.[0] === 7 && tags[273]?.length === 1
        ? tags[279]?.[0]
        : undefined);
    if (start !== undefined && size && start + size <= bytes.length) {
      const data = bytes.subarray(start, start + size);
      try {
        candidates.push({ bytes: data, ...jpegDimensions(data) });
      } catch {
        /* A DNG raw strip is not a preview. */
      }
    }
    for (const next of tags[330] || []) ifd(next, depth + 1);
    ifd(v.getUint32(offset + 2 + n * 12, le), depth + 1);
  }
  ifd(v.getUint32(4, le));
  candidates.sort((a, b) => b.width * b.height - a.width * a.height);
  if (!candidates.length)
    throw new Error(
      '이 DNG에는 추출 가능한 JPEG가 없습니다. 현상한 JPG/TIFF를 사용하세요.',
    );
  return { bytes: candidates[0].bytes, metadata: [{ bytes, isGps: false }] };
}
