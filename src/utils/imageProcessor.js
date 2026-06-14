import UTIF from 'utif';
import imageCompression from 'browser-image-compression';
import jpegJs from 'jpeg-js';

const INSTAGRAM_MAX_LANDSCAPE = 1.91;
const INSTAGRAM_MIN_PORTRAIT = 1 / 1.35;

async function getImageDimensions(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지 크기를 읽을 수 없습니다'));
    };
    img.src = url;
  });
}

async function resizeToCanvas(blob, maxDimension) {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;

  const scale = Math.max(width, height) > maxDimension
    ? maxDimension / Math.max(width, height)
    : 1;
  const tw = Math.round(width * scale);
  const th = Math.round(height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, tw, th);
  ctx.drawImage(bitmap, 0, 0, tw, th);
  bitmap.close();

  return ctx.getImageData(0, 0, tw, th);
}

export const processImageForInstagram = async (file) => {
  try {
    let sourceBlob = file;
    const nameLower = file.name.toLowerCase();

    if (nameLower.endsWith('.tif') || nameLower.endsWith('.tiff') || nameLower.endsWith('.dng')) {
      sourceBlob = await convertTiffOrDngToBlob(file);
    } else if (nameLower.endsWith('.heic') || nameLower.endsWith('.heif')) {
      sourceBlob = await convertHeicToBlob(file);
    }

    const { width, height } = await getImageDimensions(sourceBlob);
    const aspectRatio = width / height;

    let warning = null;
    if (aspectRatio > INSTAGRAM_MAX_LANDSCAPE) {
      warning = `화면비 ${aspectRatio.toFixed(2)}:1 — 인스타 지원 범위(최대 1.91:1) 초과. 업로드 시 좌우가 크롭됩니다.`;
    } else if (aspectRatio < INSTAGRAM_MIN_PORTRAIT) {
      warning = `화면비 1:${(1 / aspectRatio).toFixed(2)} — 인스타 지원 범위(최대 4:5) 초과. 업로드 시 상하가 크롭됩니다.`;
    }

    const imageData = await resizeToCanvas(sourceBlob, 4096);

    const maxBytes = 10 * 1024 * 1024;
    let quality = 92;
    let encoded;

    do {
      const result = jpegJs.encode(
        { data: new Uint8Array(imageData.data.buffer), width: imageData.width, height: imageData.height },
        quality
      );
      encoded = result.data;
      if (encoded.byteLength <= maxBytes || quality <= 60) break;
      quality -= 3;
    } while (true);

    const compressedFile = new Blob([encoded], { type: 'image/jpeg' });
    const preview = URL.createObjectURL(compressedFile);

    return {
      success: true,
      file: compressedFile,
      preview,
      format: 'jpg',
      originalSize: file.size,
      compressedSize: compressedFile.size,
      ratio: ((1 - compressedFile.size / file.size) * 100).toFixed(1),
      warning,
    };
  } catch (error) {
    console.error('Instagram processing failed:', error);
    return { success: false, error: error.message };
  }
};

export const processImage = async (file, options = { maxSizeMB: 20, format: 'webp' }) => {
  const { maxSizeMB, format } = options;
  
  try {
    let sourceBlob = file;
    const nameLower = file.name.toLowerCase();
    
    // 1. Convert special formats (TIFF, DNG, HEIC/HEIF) to standard Blob
    if (nameLower.endsWith('.tif') || nameLower.endsWith('.tiff') || nameLower.endsWith('.dng')) {
      sourceBlob = await convertTiffOrDngToBlob(file);
    } else if (nameLower.endsWith('.heic') || nameLower.endsWith('.heif')) {
      sourceBlob = await convertHeicToBlob(file);
    }

    // 2. Process / Compress
    // If maxSizeMB is null or negative, we treat it as "Original" (no compression)
    const isOriginal = maxSizeMB === null || maxSizeMB <= 0;
    
    const compressionOptions = {
      maxSizeMB: isOriginal ? 10000 : maxSizeMB,
      maxWidthOrHeight: 16384,
      useWebWorker: true,
      initialQuality: isOriginal ? 1.0 : 0.9,
      fileType: `image/${format === 'jpg' ? 'jpeg' : format}`,
      preserveExif: true,
    };

    const compressedFile = await imageCompression(sourceBlob, compressionOptions);

    const preview = URL.createObjectURL(compressedFile);

    return {
      success: true,
      file: compressedFile,
      preview,
      format,
      originalSize: file.size,
      compressedSize: compressedFile.size,
      ratio: ((1 - compressedFile.size / file.size) * 100).toFixed(1)
    };
  } catch (error) {
    console.error('Processing failed:', error);
    return { success: false, error: error.message };
  }
};

const convertTiffOrDngToBlob = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buffer = e.target.result;
        const ifds = UTIF.decode(buffer);
        if (!ifds || ifds.length === 0) {
          throw new Error('TIFF/DNG image directory not found.');
        }

        // Sort IFDs by resolution to find the largest image/preview first
        const sortedIfds = [...ifds].map((ifd, index) => ({ ifd, index }))
          .sort((a, b) => {
            const sizeA = (a.ifd.width || 0) * (a.ifd.height || 0);
            const sizeB = (b.ifd.width || 0) * (b.ifd.height || 0);
            return sizeB - sizeA;
          });

        let rgba = null;
        let selectedIfd = null;

        for (const item of sortedIfds) {
          try {
            UTIF.decodeImage(buffer, item.ifd);
            rgba = UTIF.toRGBA8(item.ifd);
            if (rgba && rgba.length > 0) {
              selectedIfd = item.ifd;
              break;
            }
          } catch (err) {
            console.warn(`Failed to decode IFD ${item.index}:`, err);
          }
        }

        if (!selectedIfd || !rgba) {
          throw new Error('디코딩 가능한 이미지 데이터를 찾을 수 없습니다.');
        }

        const canvas = document.createElement('canvas');
        canvas.width = selectedIfd.width;
        canvas.height = selectedIfd.height;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(canvas.width, canvas.height);
        imgData.data.set(rgba);
        ctx.putImageData(imgData, 0, 0);

        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Canvas to Blob conversion failed'));
          }
        }, 'image/png');
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
};

const convertHeicToBlob = async (file) => {
  const heic2anyModule = await import('heic2any');
  const heic2any = heic2anyModule.default || heic2anyModule;
  const result = await heic2any({
    blob: file,
    toType: 'image/png'
  });
  return Array.isArray(result) ? result[0] : result;
};
