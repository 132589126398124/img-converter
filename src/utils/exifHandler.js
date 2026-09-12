import exifr from 'exifr';
import piexif from 'piexifjs';

/**
 * Extracts user-friendly EXIF metadata for display in the UI / Compare modal.
 */
export async function extractExifMetadata(file) {
  try {
    const data = await exifr.parse(file, {
      tiff: true,
      exif: true,
      gps: false,
      pick: [
        'Make',
        'Model',
        'LensModel',
        'FNumber',
        'ExposureTime',
        'ISO',
        'FocalLength',
        'DateTimeOriginal',
        'ExifImageWidth',
        'ExifImageHeight',
        'Orientation'
      ]
    });

    if (!data) return null;

    const formatExposureTime = (exp) => {
      if (!exp) return null;
      if (exp >= 1) return `${exp.toFixed(1)}s`;
      const denominator = Math.round(1 / exp);
      return `1/${denominator}s`;
    };

    const formatDateTime = (date) => {
      if (!date) return null;
      if (date instanceof Date) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
      }
      return String(date);
    };

    const camera = [data.Make, data.Model].filter(Boolean).join(' ').trim();
    const lens = data.LensModel || null;
    const aperture = data.FNumber ? `f/${data.FNumber.toFixed(1)}` : null;
    const shutter = formatExposureTime(data.ExposureTime);
    const iso = data.ISO ? `ISO ${data.ISO}` : null;
    const focalLength = data.FocalLength ? `${Math.round(data.FocalLength)}mm` : null;
    const dateTime = formatDateTime(data.DateTimeOriginal);

    const exposureSummary = [aperture, shutter, iso, focalLength].filter(Boolean).join(' • ');

    return {
      camera: camera || null,
      lens: lens || null,
      exposureSummary: exposureSummary || null,
      dateTime: dateTime || null,
      rawOrientation: data.Orientation || 1,
    };
  } catch (err) {
    console.warn('Failed to parse EXIF metadata:', err);
    return null;
  }
}

/**
 * Extracts raw APP1 segment (0xFFE1) from JPEG ArrayBuffer or typed array.
 */
export function extractApp1Segment(input) {
  if (!input) return null;
  const arrayBuffer = input instanceof ArrayBuffer ? input : input.buffer;
  const byteOffset = input.byteOffset || 0;
  const byteLength = input.byteLength !== undefined ? input.byteLength : arrayBuffer.byteLength;
  const view = new DataView(arrayBuffer, byteOffset, byteLength);

  if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return null;

  let offset = 2;
  while (offset + 4 < view.byteLength) {
    if (view.getUint8(offset) !== 0xFF) break;
    const marker = view.getUint8(offset + 1);
    if (marker === 0xDA || marker === 0xD9) break; // SOS or EOI

    const length = view.getUint16(offset + 2);
    if (marker === 0xE1) {
      if (offset + 10 <= view.byteLength) {
        const isExif = view.getUint32(offset + 4) === 0x45786966 && view.getUint16(offset + 8) === 0x0000;
        if (isExif) {
          const seg = new Uint8Array(arrayBuffer, byteOffset + offset, length + 2);
          return new Uint8Array(seg); // clone copy
        }
      }
    }
    offset += 2 + length;
  }
  return null;
}

/**
 * Resets the EXIF Orientation tag (0x0112) in an APP1 segment to 1 (Normal).
 * Prevents double-rotation in downstream viewers when canvas has already baked orientation.
 */
export function normalizeOrientationInApp1(app1Bytes) {
  const view = new DataView(app1Bytes.buffer, app1Bytes.byteOffset, app1Bytes.byteLength);
  const tiffOffset = 10;
  if (tiffOffset + 8 > app1Bytes.byteLength) return false;

  const endian = view.getUint16(tiffOffset);
  const littleEndian = endian === 0x4949; // 'II'
  if (!littleEndian && endian !== 0x4D4D) return false;

  const ifd0Offset = tiffOffset + view.getUint32(tiffOffset + 4, littleEndian);
  if (ifd0Offset + 2 > app1Bytes.byteLength) return false;

  const numEntries = view.getUint16(ifd0Offset, littleEndian);
  for (let i = 0; i < numEntries; i++) {
    const entryOffset = ifd0Offset + 2 + i * 12;
    if (entryOffset + 12 > app1Bytes.byteLength) break;
    const tag = view.getUint16(entryOffset, littleEndian);
    if (tag === 0x0112) {
      view.setUint16(entryOffset + 8, 1, littleEndian); // Set orientation to 1
      return true;
    }
  }
  return false;
}

/**
 * Injects an APP1 segment into a freshly encoded JPEG.
 */
export function injectApp1IntoJpeg(targetJpegBytes, app1Bytes) {
  const view = new DataView(targetJpegBytes.buffer, targetJpegBytes.byteOffset, targetJpegBytes.byteLength);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return targetJpegBytes;

  let insertOffset = 2;
  // If target has APP0 (JFIF), insert after APP0
  if (view.byteLength > 4 && view.getUint16(2) === 0xFFE0) {
    const app0Len = view.getUint16(4);
    insertOffset = 4 + app0Len;
  }

  // Remove existing APP1 in target if present
  let skipLen = 0;
  if (insertOffset + 4 < view.byteLength && view.getUint16(insertOffset) === 0xFFE1) {
    skipLen = 2 + view.getUint16(insertOffset + 2);
  }

  const before = targetJpegBytes.subarray(0, insertOffset);
  const after = targetJpegBytes.subarray(insertOffset + skipLen);

  const result = new Uint8Array(before.length + app1Bytes.length + after.length);
  result.set(before, 0);
  result.set(app1Bytes, before.length);
  result.set(after, before.length + app1Bytes.length);
  return result;
}

/**
 * Attaches EXIF metadata from sourceFile to a newly generated JPEG Blob.
 */
export async function attachExifToJpeg(targetBlob, sourceFile) {
  try {
    const sourceBuffer = await sourceFile.arrayBuffer();
    const app1 = extractApp1Segment(sourceBuffer);

    if (app1) {
      normalizeOrientationInApp1(app1);
      const targetBuffer = await targetBlob.arrayBuffer();
      const newBytes = injectApp1IntoJpeg(new Uint8Array(targetBuffer), app1);
      return new Blob([newBytes], { type: 'image/jpeg' });
    }

    // If source is not JPEG (e.g. HEIC, TIFF), try extracting with exifr and rebuilding EXIF with piexif
    const tags = await exifr.parse(sourceFile, { tiff: true, exif: true, mergeOutput: true });
    if (tags && (tags.Make || tags.Model || tags.DateTimeOriginal)) {
      const zeroth = {};
      const exif = {};

      if (tags.Make) zeroth[piexif.ImageIFD.Make] = String(tags.Make);
      if (tags.Model) zeroth[piexif.ImageIFD.Model] = String(tags.Model);
      zeroth[piexif.ImageIFD.Orientation] = 1;

      if (tags.DateTimeOriginal) {
        const dateStr = tags.DateTimeOriginal instanceof Date 
          ? tags.DateTimeOriginal.toISOString().replace(/T/, ' ').replace(/\..+/, '').replace(/-/g, ':')
          : String(tags.DateTimeOriginal);
        zeroth[piexif.ImageIFD.DateTime] = dateStr;
        exif[piexif.ExifIFD.DateTimeOriginal] = dateStr;
      }
      if (tags.ExposureTime) exif[piexif.ExifIFD.ExposureTime] = [Math.round(tags.ExposureTime * 1000000), 1000000];
      if (tags.FNumber) exif[piexif.ExifIFD.FNumber] = [Math.round(tags.FNumber * 10), 10];
      if (tags.ISO) exif[piexif.ExifIFD.ISOSpeedRatings] = tags.ISO;
      if (tags.LensModel) exif[piexif.ExifIFD.LensModel] = String(tags.LensModel);

      const exifBytes = piexif.dump({ '0th': zeroth, 'Exif': exif, 'GPS': {}, '1st': {}, 'thumbnail': null });
      const targetDataUrl = await blobToDataUrl(targetBlob);
      const outputDataUrl = piexif.insert(exifBytes, targetDataUrl);
      return dataUrlToBlob(outputDataUrl, 'image/jpeg');
    }
  } catch (err) {
    console.warn('Could not attach EXIF to JPEG:', err);
  }
  return targetBlob;
}

/**
 * Attaches EXIF metadata from sourceFile to a newly generated WebP Blob.
 */
export async function attachExifToWebp(targetBlob, sourceFile) {
  try {
    const sourceBuffer = await sourceFile.arrayBuffer();
    const app1 = extractApp1Segment(sourceBuffer);
    if (!app1) return targetBlob;

    normalizeOrientationInApp1(app1);
    const tiffBytes = app1.subarray(10); // Strip 0xFFE1, length, Exif\0\0

    const targetBuffer = await targetBlob.arrayBuffer();
    const webpBytes = new Uint8Array(targetBuffer);

    if (webpBytes.length < 12) return targetBlob;

    // Build EXIF chunk
    const exifHeader = new Uint8Array(8);
    exifHeader.set([0x45, 0x58, 0x49, 0x46], 0); // 'EXIF'
    new DataView(exifHeader.buffer).setUint32(4, tiffBytes.length, true);
    const pad = tiffBytes.length % 2 === 1 ? new Uint8Array([0x00]) : new Uint8Array(0);

    const firstChunkFourCC = String.fromCharCode(...webpBytes.subarray(12, 16));
    if (firstChunkFourCC === 'VP8X') {
      webpBytes[20] = webpBytes[20] | 0x08; // Set EXIF flag
      const newTotal = webpBytes.length + exifHeader.length + tiffBytes.length + pad.length;
      const finalBytes = new Uint8Array(newTotal);
      finalBytes.set(webpBytes, 0);

      let pos = webpBytes.length;
      finalBytes.set(exifHeader, pos); pos += exifHeader.length;
      finalBytes.set(tiffBytes, pos); pos += tiffBytes.length;
      if (pad.length) finalBytes.set(pad, pos);

      new DataView(finalBytes.buffer).setUint32(4, newTotal - 8, true);
      return new Blob([finalBytes], { type: 'image/webp' });
    }
  } catch (err) {
    console.warn('Could not attach EXIF to WebP:', err);
  }
  return targetBlob;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl, mimeType) {
  const byteString = atob(dataUrl.split(',')[1]);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeType });
}
