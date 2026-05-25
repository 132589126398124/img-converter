import UTIF from 'utif';
import imageCompression from 'browser-image-compression';
import mozjpegFactory from '@wasm-codecs/mozjpeg/lib/mozjpeg.js';
import mozjpegWasmUrl from '@wasm-codecs/mozjpeg/lib/mozjpeg.wasm?url';

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

let _mozjpeg = null;

async function getMozjpeg() {
  if (_mozjpeg) return _mozjpeg;
  await new Promise((resolve) => {
    _mozjpeg = mozjpegFactory({
      locateFile: (path) => path.endsWith('.wasm') ? mozjpegWasmUrl : path,
      onRuntimeInitialized: resolve,
    });
  });
  return _mozjpeg;
}

function rgbaToRgb(data, w, h) {
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    rgb[i * 3]     = data[i * 4];
    rgb[i * 3 + 1] = data[i * 4 + 1];
    rgb[i * 3 + 2] = data[i * 4 + 2];
  }
  return rgb;
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

    if (file.name.toLowerCase().endsWith('.tif') || file.name.toLowerCase().endsWith('.tiff')) {
      sourceBlob = await convertTiffToBlob(file);
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

    const mj = await getMozjpeg();
    const rgb = rgbaToRgb(imageData.data, imageData.width, imageData.height);

    const maxBytes = 10 * 1024 * 1024;
    let quality = 92;
    let encoded;

    do {
      const ptr = mj.encode(rgb, imageData.width, imageData.height, 3, {
        quality,
        autoSubsample: false,
        chromaSubsample: 1,
        progressive: true,
        optimizeCoding: true,
      });
      encoded = new Uint8Array(mj.getImage(ptr));
      mj.freeImage(ptr);
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
    
    // 1. Handle TIFF specifically
    if (file.name.toLowerCase().endsWith('.tif') || file.name.toLowerCase().endsWith('.tiff')) {
      sourceBlob = await convertTiffToBlob(file);
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

const convertTiffToBlob = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const ifds = UTIF.decode(e.target.result);
        UTIF.decodeImage(e.target.result, ifds[0]);
        const rgba = UTIF.toRGBA8(ifds[0]);
        
        const canvas = document.createElement('canvas');
        canvas.width = ifds[0].width;
        canvas.height = ifds[0].height;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(canvas.width, canvas.height);
        imgData.data.set(rgba);
        ctx.putImageData(imgData, 0, 0);
        
        canvas.toBlob((blob) => {
          resolve(blob);
        }, 'image/png');
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
};
