import exifr from 'exifr';
import piexif from 'piexifjs';
import { textAt, viewOf, sniff, webpChunks } from './containers.js';

export const SHOT_KEYS = [
  'Make',
  'Model',
  'LensMake',
  'LensModel',
  'ExposureTime',
  'FNumber',
  'ISO',
  'FocalLength',
  'DateTimeOriginal',
  'SubSecTimeOriginal',
  'OffsetTimeOriginal',
  'Artist',
  'Copyright',
];
const GPS_KEYS = [
  'GPSLatitudeRef',
  'GPSLatitude',
  'GPSLongitudeRef',
  'GPSLongitude',
  'GPSAltitudeRef',
  'GPSAltitude',
  'GPSDateStamp',
  'GPSTimeStamp',
];
const hasValue = (value) =>
  value !== undefined && value !== null && value !== '';
export async function readMetadata(bytes) {
  try {
    if (sniff(bytes) === 'webp') {
      bytes = webpChunks(bytes).find((c) => c.type === 'EXIF')?.data;
      if (!bytes) return {};
    }
    if (textAt(bytes, 0, 6) === 'Exif\0\0') bytes = bytes.subarray(6);
    const data = await exifr.parse(bytes, {
      tiff: true,
      exif: true,
      gps: true,
      xmp: false,
      iptc: false,
      icc: false,
      translateValues: false,
      reviveValues: false,
      mergeOutput: true,
      pick: [...SHOT_KEYS, ...GPS_KEYS, 'Orientation', 'ColorSpace'],
    });
    return data || {};
  } catch {
    return {};
  }
}

// CMT2 stores EXIF tags directly in its TIFF root IFD, outside a JPEG EXIF pointer.
export function readCmt(bytes, isGps = false) {
  const result = {},
    v = viewOf(bytes),
    le = textAt(bytes, 0, 2) === 'II';
  if (bytes.length < 8 || v.getUint16(2, le) !== 42) return result;
  const names = {
    0x10f: 'Make',
    0x110: 'Model',
    0x112: 'Orientation',
    0x13b: 'Artist',
    0x8298: 'Copyright',
    0x829a: 'ExposureTime',
    0x829d: 'FNumber',
    0x8827: 'ISO',
    0x9003: 'DateTimeOriginal',
    0x9011: 'OffsetTimeOriginal',
    0x9291: 'SubSecTimeOriginal',
    0x920a: 'FocalLength',
    0xa434: 'LensModel',
    0xa433: 'LensMake',
  };
  const gps = {
    1: 'GPSLatitudeRef',
    2: 'GPSLatitude',
    3: 'GPSLongitudeRef',
    4: 'GPSLongitude',
    5: 'GPSAltitudeRef',
    6: 'GPSAltitude',
    7: 'GPSTimeStamp',
    29: 'GPSDateStamp',
  };
  const ifd = v.getUint32(4, le);
  if (ifd + 2 > bytes.length) return result;
  const count = v.getUint16(ifd, le);
  for (let i = 0; i < count; i++) {
    const p = ifd + 2 + i * 12;
    if (p + 12 > bytes.length) break;
    const tag = v.getUint16(p, le),
      key = (isGps ? gps : names)[tag],
      type = v.getUint16(p + 2, le),
      n = v.getUint32(p + 4, le);
    const unit = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 }[type];
    if (!key || !unit || n > 10000) continue;
    const at = n * unit <= 4 ? p + 8 : v.getUint32(p + 8, le);
    if (at + n * unit > bytes.length) continue;
    if (type === 2) result[key] = textAt(bytes, at, n).replace(/\0+$/, '');
    else {
      const values = Array.from({ length: n }, (_, j) =>
        type === 5
          ? v.getUint32(at + j * 8, le) / v.getUint32(at + j * 8 + 4, le)
          : type === 4
            ? v.getUint32(at + j * 4, le)
            : type === 3
              ? v.getUint16(at + j * 2, le)
              : v.getUint8(at + j),
      );
      result[key] = values.length === 1 ? values[0] : values;
    }
  }
  return result;
}

const ascii = (value) =>
  typeof value === 'string' && /^[\x20-\x7e]*$/.test(value);
const rational = (value) => [Math.round(Number(value) * 1000000), 1000000];
export function buildExif(metadata, recipe, width, height) {
  if (recipe.metadata === 'strip') return null;
  const expected = Object.fromEntries(
    [...SHOT_KEYS, ...(recipe.gps ? GPS_KEYS : [])]
      .filter((k) => hasValue(metadata[k]))
      .map((k) => [k, metadata[k]]),
  );
  if (!Object.keys(expected).length) return null;
  const root = {
    [piexif.ImageIFD.Orientation]: 1,
    [piexif.ImageIFD.ImageWidth]: width,
    [piexif.ImageIFD.ImageLength]: height,
  };
  const exif = {
      [piexif.ExifIFD.PixelXDimension]: width,
      [piexif.ExifIFD.PixelYDimension]: height,
    },
    gps = {};
  for (const name of ['Make', 'Model', 'Artist', 'Copyright'])
    if (ascii(metadata[name])) root[piexif.ImageIFD[name]] = metadata[name];
  for (const name of [
    'LensMake',
    'LensModel',
    'DateTimeOriginal',
    'SubSecTimeOriginal',
  ])
    if (ascii(metadata[name])) exif[piexif.ExifIFD[name]] = metadata[name];
  // piexif predates EXIF 2.31; register its standard timezone tag explicitly.
  if (ascii(metadata.OffsetTimeOriginal)) {
    piexif.TAGS.Exif[0x9011] = { name: 'OffsetTimeOriginal', type: 'Ascii' };
    exif[0x9011] = metadata.OffsetTimeOriginal;
  }
  for (const name of ['ExposureTime', 'FNumber', 'FocalLength'])
    if (Number.isFinite(metadata[name]) && metadata[name] >= 0)
      exif[piexif.ExifIFD[name]] = rational(metadata[name]);
  if (Number.isFinite(metadata.ISO))
    exif[piexif.ExifIFD.ISOSpeedRatings] = metadata.ISO;
  if (recipe.gps) {
    for (const key of GPS_KEYS) {
      const value = metadata[key],
        tag = piexif.GPSIFD[key];
      if (value === undefined || tag === undefined) continue;
      if (
        ['GPSLatitude', 'GPSLongitude', 'GPSTimeStamp'].includes(key) &&
        Array.isArray(value)
      )
        gps[tag] = value.map(rational);
      else if (key === 'GPSAltitude') gps[tag] = rational(value);
      else if (typeof value === 'number' || ascii(value)) gps[tag] = value;
    }
  }
  return Uint8Array.from(
    piexif.dump({
      '0th': root,
      Exif: exif,
      GPS: gps,
      '1st': {},
      thumbnail: null,
    }),
    (c) => c.charCodeAt(0),
  );
}

function equalValue(a, b) {
  if (typeof a === 'number' && typeof b === 'number')
    return Math.abs(a - b) <= Math.max(0.000002, Math.abs(a) * 0.000002);
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => equalValue(v, b[i]));
  return a === b;
}
export function verifyShotMetadata(source, output, recipe) {
  if (recipe.metadata === 'strip') {
    if ([...SHOT_KEYS, ...GPS_KEYS].some((k) => output[k] !== undefined))
      throw new Error('촬영정보 제거 검증에 실패했습니다.');
    return 'stripped';
  }
  if (!recipe.gps && GPS_KEYS.some((k) => output[k] !== undefined))
    throw new Error('위치정보 제거 검증에 실패했습니다.');
  const keys = [...SHOT_KEYS, ...(recipe.gps ? GPS_KEYS : [])].filter((k) =>
    hasValue(source[k]),
  );
  if (!keys.length) return 'none';
  return keys.every((k) => equalValue(source[k], output[k]))
    ? 'verified'
    : 'partial';
}
