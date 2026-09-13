import UTIF from 'utif';
import Pica from 'pica';
import { extractExifMetadata, attachExifToJpeg, attachExifToWebp } from './exifHandler.js';

const pica = new Pica({
  features: ['js', 'wasm', 'cib']
});

const INSTAGRAM_MAX_LANDSCAPE = 1.91;
const INSTAGRAM_MIN_PORTRAIT = 0.8; // 4:5

/**
 * Checks if the browser supports encoding to AVIF.
 */
export const isAvifSupported = () => {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    return canvas.toDataURL('image/avif').startsWith('data:image/avif');
  } catch {
    return false;
  }
};

/**
 * Get natural dimensions and aspect ratio from a blob.
 */
export async function getImageDimensions(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      URL.revokeObjectURL(url);
      resolve({
        width,
        height,
        aspectRatio: width / height
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지 크기를 읽을 수 없습니다'));
    };
    img.src = url;
  });
}

/**
 * Calculates resized dimensions preserving aspect ratio with target long edge.
 */
export function calculateTargetDimensions(srcWidth, srcHeight, targetLongEdge, preventUpscale = true) {
  const currentLongEdge = Math.max(srcWidth, srcHeight);
  if (!targetLongEdge || targetLongEdge <= 0) {
    return { width: srcWidth, height: srcHeight, scale: 1 };
  }

  if (preventUpscale && currentLongEdge <= targetLongEdge) {
    return { width: srcWidth, height: srcHeight, scale: 1 };
  }

  const scale = targetLongEdge / currentLongEdge;
  const width = Math.max(1, Math.round(srcWidth * scale));
  const height = Math.max(1, Math.round(srcHeight * scale));
  return { width, height, scale };
}

/**
 * High quality downscaling using Pica (Lanczos3) with stepped canvas fallback.
 */
async function resizeCanvasHighQuality(sourceCanvas, targetWidth, targetHeight) {
  const targetCanvas = document.createElement('canvas');
  targetCanvas.width = targetWidth;
  targetCanvas.height = targetHeight;

  if (sourceCanvas.width === targetWidth && sourceCanvas.height === targetHeight) {
    const ctx = targetCanvas.getContext('2d');
    ctx.drawImage(sourceCanvas, 0, 0);
    return targetCanvas;
  }

  try {
    await pica.resize(sourceCanvas, targetCanvas, {
      quality: 3, // Lanczos3 filter - highest quality
      alpha: true,
      unsharpAmount: 35,
      unsharpRadius: 0.5,
      unsharpThreshold: 2,
    });
    return targetCanvas;
  } catch (err) {
    console.warn('Pica resize failed, falling back to stepped canvas:', err);
    return steppedDownscale(sourceCanvas, targetWidth, targetHeight);
  }
}

/**
 * Stepped canvas downscale for high sharpness and moire prevention fallback.
 */
function steppedDownscale(sourceCanvas, targetWidth, targetHeight) {
  let curWidth = sourceCanvas.width;
  let curHeight = sourceCanvas.height;
  let curCanvas = sourceCanvas;

  while (curWidth * 0.5 > targetWidth && curHeight * 0.5 > targetHeight) {
    const nextCanvas = document.createElement('canvas');
    curWidth = Math.round(curWidth * 0.5);
    curHeight = Math.round(curHeight * 0.5);
    nextCanvas.width = curWidth;
    nextCanvas.height = curHeight;

    const ctx = nextCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(curCanvas, 0, 0, curWidth, curHeight);

    if (curCanvas !== sourceCanvas) {
      curCanvas.width = 0;
      curCanvas.height = 0;
    }
    curCanvas = nextCanvas;
  }

  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = targetWidth;
  finalCanvas.height = targetHeight;
  const ctx = finalCanvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(curCanvas, 0, 0, targetWidth, targetHeight);

  if (curCanvas !== sourceCanvas) {
    curCanvas.width = 0;
    curCanvas.height = 0;
  }
  return finalCanvas;
}

/**
 * Loads Blob into an upright HTMLCanvasElement using createImageBitmap.
 */
async function blobToCanvas(blob) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob, {
      imageOrientation: 'from-image',
      colorSpaceConversion: 'default',
    });
  } catch {
    // Fallback if createImageBitmap fails
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        resolve(canvas);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('이미지 디코딩에 실패했습니다.'));
      };
      img.src = url;
    });
  }

  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

/**
 * Composites canvas onto a solid background for formats without alpha channel (e.g. JPEG).
 */
function compositeBackground(canvas, bgColor = '#ffffff') {
  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = canvas.width;
  resultCanvas.height = canvas.height;
  const ctx = resultCanvas.getContext('2d');

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(canvas, 0, 0);
  return resultCanvas;
}

/**
 * Main Image Processing Function.
 */
export const processImage = async (file, options = {}) => {
  const {
    format = 'webp',
    targetLongEdge = 0,
    preventUpscale = true,
    qualityMode = 'quality', // 'quality' | 'size'
    qualityPercent = 90,     // 1 ~ 100
    maxSizeMB = 10,
    preserveExif = true,
    backgroundColor = '#ffffff',
  } = options;

  let sourceCanvas = null;
  let resizedCanvas = null;
  let finalCanvas = null;

  try {
    const nameLower = file.name.toLowerCase();
    const isJpg = nameLower.endsWith('.jpg') || nameLower.endsWith('.jpeg') || file.type === 'image/jpeg';
    const isPng = nameLower.endsWith('.png') || file.type === 'image/png';
    const isWebp = nameLower.endsWith('.webp') || file.type === 'image/webp';
    const isAvif = nameLower.endsWith('.avif') || file.type === 'image/avif';

    const isSameFormat = (isJpg && format === 'jpg') ||
                         (isPng && format === 'png') ||
                         (isWebp && format === 'webp') ||
                         (isAvif && format === 'avif');

    // Extract EXIF tags for display early
    const exifSummary = await extractExifMetadata(file);

    let sourceBlob = file;
    if (nameLower.endsWith('.tif') || nameLower.endsWith('.tiff') || nameLower.endsWith('.dng')) {
      sourceBlob = await convertTiffOrDngToBlob(file);
    } else if (nameLower.endsWith('.heic') || nameLower.endsWith('.heif')) {
      sourceBlob = await convertHeicToBlob(file);
    }

    const { width: origWidth, height: origHeight } = await getImageDimensions(sourceBlob);
    const { width: targetWidth, height: targetHeight, scale } = calculateTargetDimensions(
      origWidth,
      origHeight,
      targetLongEdge,
      preventUpscale
    );

    // Bypass check: If format is same, no resizing occurred (scale === 1), and quality is 100%
    if (isSameFormat && scale === 1 && qualityMode === 'quality' && qualityPercent === 100) {
      const preview = URL.createObjectURL(file);
      return {
        success: true,
        file,
        preview,
        format,
        originalSize: file.size,
        compressedSize: file.size,
        originalWidth: origWidth,
        originalHeight: origHeight,
        outputWidth: origWidth,
        outputHeight: origHeight,
        ratio: '0.0',
        exif: exifSummary,
      };
    }

    sourceCanvas = await blobToCanvas(sourceBlob);
    resizedCanvas = await resizeCanvasHighQuality(sourceCanvas, targetWidth, targetHeight);

    // Alpha channel handling: JPEG doesn't support transparency, composite over background
    const isTargetJpeg = format === 'jpg';
    finalCanvas = isTargetJpeg ? compositeBackground(resizedCanvas, backgroundColor) : resizedCanvas;

    const mimeType = format === 'jpg' ? 'image/jpeg' : `image/${format}`;

    let compressedBlob;

    if (qualityMode === 'size') {
      // Target File Size Mode (MB)
      const targetBytes = maxSizeMB * 1024 * 1024;
      let low = 0.4;
      let high = 0.98;
      let bestBlob = null;

      // Binary search for optimal quality
      for (let i = 0; i < 5; i++) {
        const mid = (low + high) / 2;
        const blob = await canvasToBlob(finalCanvas, mimeType, mid);
        if (!bestBlob || Math.abs(blob.size - targetBytes) < Math.abs(bestBlob.size - targetBytes)) {
          bestBlob = blob;
        }
        if (blob.size > targetBytes) {
          high = mid;
        } else {
          low = mid;
        }
      }
      compressedBlob = bestBlob || (await canvasToBlob(finalCanvas, mimeType, 0.85));
    } else {
      // Quality Percentage Mode (%)
      if (format === 'png') {
        // PNG is inherently lossless
        compressedBlob = await canvasToBlob(finalCanvas, 'image/png');
      } else {
        const quality = Math.min(Math.max(qualityPercent / 100, 0.05), 1.0);
        compressedBlob = await canvasToBlob(finalCanvas, mimeType, quality);
      }
    }

    // Preserve EXIF metadata if enabled
    if (preserveExif) {
      if (format === 'jpg') {
        compressedBlob = await attachExifToJpeg(compressedBlob, file);
      } else if (format === 'webp') {
        compressedBlob = await attachExifToWebp(compressedBlob, file);
      }
    }

    const preview = URL.createObjectURL(compressedBlob);
    const ratio = ((1 - compressedBlob.size / file.size) * 100).toFixed(1);

    return {
      success: true,
      file: compressedBlob,
      preview,
      format,
      originalSize: file.size,
      compressedSize: compressedBlob.size,
      originalWidth: origWidth,
      originalHeight: origHeight,
      outputWidth: targetWidth,
      outputHeight: targetHeight,
      ratio,
      exif: exifSummary,
    };
  } catch (error) {
    console.error('Processing failed:', error);
    return { success: false, error: error.message || '이미지 변환 중 오류가 발생했습니다.' };
  } finally {
    if (sourceCanvas) { sourceCanvas.width = 0; sourceCanvas.height = 0; }
    if (resizedCanvas && resizedCanvas !== finalCanvas) { resizedCanvas.width = 0; resizedCanvas.height = 0; }
    if (finalCanvas) { finalCanvas.width = 0; finalCanvas.height = 0; }
  }
};

/**
 * Enhanced Instagram Processing with Framing / Letterboxing & High Quality.
 */
export const processImageForInstagram = async (file, options = {}) => {
  const {
    frameMode = 'white', // 'none' | 'white' | 'black' | 'blur'
    targetLongEdge = 2160,
    preserveExif = true,
    splitMode = 'none', // 'none' | '2' | '3'
    splitFit = 'crop',  // 'crop' (화면 꽉 채우기) | 'fit' (전체 사진 보존)
  } = options;

  let sourceCanvas = null;
  let finalCanvas = null;
  let compositeCanvas = null;

  try {
    let sourceBlob = file;
    const nameLower = file.name.toLowerCase();

    if (nameLower.endsWith('.tif') || nameLower.endsWith('.tiff') || nameLower.endsWith('.dng')) {
      sourceBlob = await convertTiffOrDngToBlob(file);
    } else if (nameLower.endsWith('.heic') || nameLower.endsWith('.heif')) {
      sourceBlob = await convertHeicToBlob(file);
    }

    const exifSummary = await extractExifMetadata(file);
    const { width: origWidth, height: origHeight, aspectRatio } = await getImageDimensions(sourceBlob);

    sourceCanvas = await blobToCanvas(sourceBlob);

    const isSplitRequested = (splitMode === '2' || splitMode === '3' || splitMode === 2 || splitMode === 3);

    // Panorama Slicing for Landscape Photos (width > height)
    if (isSplitRequested && origWidth > origHeight) {
      const splitCount = parseInt(splitMode, 10); // 2 or 3
      // Instagram 4:5 vertical portrait standard: ratio = 0.8
      const hCut = Math.min(targetLongEdge, Math.max(origHeight, 1350));
      const wCut = Math.round(hCut * 0.8);
      const wTotal = splitCount * wCut;
      const hTotal = hCut;

      let scale, sw, sh, dx, dy;
      if (splitFit === 'fit') {
        // Fit whole photo without cropping (padding if needed)
        scale = Math.min(wTotal / origWidth, hTotal / origHeight);
        sw = Math.round(origWidth * scale);
        sh = Math.round(origHeight * scale);
        dx = Math.round((wTotal - sw) / 2);
        dy = Math.round((hTotal - sh) / 2);
      } else {
        // Fill & crop to fill canvas without borders
        scale = Math.max(wTotal / origWidth, hTotal / origHeight);
        sw = Math.round(origWidth * scale);
        sh = Math.round(origHeight * scale);
        dx = Math.round((wTotal - sw) / 2);
        dy = Math.round((hTotal - sh) / 2);
      }

      compositeCanvas = document.createElement('canvas');
      compositeCanvas.width = wTotal;
      compositeCanvas.height = hTotal;
      const compCtx = compositeCanvas.getContext('2d');

      if (splitFit === 'fit') {
        if (frameMode === 'black') {
          compCtx.fillStyle = '#000000';
          compCtx.fillRect(0, 0, wTotal, hTotal);
        } else if (frameMode === 'blur') {
          compCtx.save();
          compCtx.filter = 'blur(40px) brightness(0.9)';
          compCtx.drawImage(sourceCanvas, -20, -20, wTotal + 40, hTotal + 40);
          compCtx.restore();
          compCtx.fillStyle = 'rgba(0, 0, 0, 0.15)';
          compCtx.fillRect(0, 0, wTotal, hTotal);
        } else {
          compCtx.fillStyle = '#ffffff';
          compCtx.fillRect(0, 0, wTotal, hTotal);
        }
      }

      // High-quality resizing to target composite size
      const resizedSrc = await resizeCanvasHighQuality(sourceCanvas, sw, sh);
      compCtx.drawImage(resizedSrc, dx, dy);
      resizedSrc.width = 0;
      resizedSrc.height = 0;

      // Slice compositeCanvas into N individual 4:5 vertical canvases
      const slices = [];
      const maxBytes = 10 * 1024 * 1024;

      for (let i = 0; i < splitCount; i++) {
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = wCut;
        sliceCanvas.height = hCut;
        const sliceCtx = sliceCanvas.getContext('2d');

        sliceCtx.drawImage(
          compositeCanvas,
          i * wCut, 0, wCut, hCut,
          0, 0, wCut, hCut
        );

        let quality = 0.94;
        let sliceBlob = await canvasToBlob(sliceCanvas, 'image/jpeg', quality);
        while (sliceBlob.size > maxBytes && quality > 0.65) {
          quality -= 0.05;
          sliceBlob = await canvasToBlob(sliceCanvas, 'image/jpeg', quality);
        }

        if (preserveExif) {
          sliceBlob = await attachExifToJpeg(sliceBlob, file);
        }

        const slicePreview = URL.createObjectURL(sliceBlob);
        slices.push({
          index: i + 1,
          total: splitCount,
          file: sliceBlob,
          preview: slicePreview,
          width: wCut,
          height: hCut,
          size: sliceBlob.size,
        });

        sliceCanvas.width = 0;
        sliceCanvas.height = 0;
      }

      const totalCompressedSize = slices.reduce((acc, s) => acc + s.size, 0);

      return {
        success: true,
        isSplit: true,
        splitCount,
        splitFit,
        slices,
        file: slices[0].file,
        preview: slices[0].preview,
        format: 'jpg',
        originalSize: file.size,
        compressedSize: totalCompressedSize,
        originalWidth: origWidth,
        originalHeight: origHeight,
        outputWidth: wCut,
        outputHeight: hCut,
        ratio: ((1 - totalCompressedSize / file.size) * 100).toFixed(1),
        exif: exifSummary,
      };
    }

    // Single-image Instagram processing (non-split or vertical/square photos)
    let warning = null;
    let needsPadding = false;

    if (isSplitRequested && origWidth <= origHeight) {
      warning = '세로 또는 정사각형 사진은 가로 파노라마 분할 대상이 아니므로 인스타그램 최적 세로 1장으로 변환되었습니다.';
    }

    if (aspectRatio > INSTAGRAM_MAX_LANDSCAPE) {
      if (frameMode === 'none') {
        warning = `화면비 ${aspectRatio.toFixed(2)}:1 — 인스타 지원 범위(최대 1.91:1) 초과. 업로드 시 좌우가 크롭됩니다.`;
      } else {
        needsPadding = true;
      }
    } else if (aspectRatio < INSTAGRAM_MIN_PORTRAIT) {
      if (frameMode === 'none') {
        warning = `화면비 1:${(1 / aspectRatio).toFixed(2)} — 인스타 지원 범위(최대 4:5) 초과. 업로드 시 상하가 크롭됩니다.`;
      } else {
        needsPadding = true;
      }
    }

    if (needsPadding && frameMode !== 'none') {
      let frameW, frameH;
      let imgW, imgH;

      if (aspectRatio < INSTAGRAM_MIN_PORTRAIT) {
        imgH = Math.min(origHeight, targetLongEdge);
        imgW = Math.round(imgH * aspectRatio);
        frameH = imgH;
        frameW = Math.round(frameH * INSTAGRAM_MIN_PORTRAIT);
      } else {
        imgW = Math.min(origWidth, targetLongEdge);
        imgH = Math.round(imgW / aspectRatio);
        frameW = imgW;
        frameH = Math.round(frameW / INSTAGRAM_MAX_LANDSCAPE);
      }

      finalCanvas = document.createElement('canvas');
      finalCanvas.width = frameW;
      finalCanvas.height = frameH;
      const ctx = finalCanvas.getContext('2d');

      if (frameMode === 'white') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, frameW, frameH);
      } else if (frameMode === 'black') {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, frameW, frameH);
      } else if (frameMode === 'blur') {
        ctx.save();
        ctx.filter = 'blur(40px) brightness(0.9)';
        ctx.drawImage(sourceCanvas, -20, -20, frameW + 40, frameH + 40);
        ctx.restore();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
        ctx.fillRect(0, 0, frameW, frameH);
      }

      const resizedImgCanvas = await resizeCanvasHighQuality(sourceCanvas, imgW, imgH);
      const offsetX = Math.round((frameW - imgW) / 2);
      const offsetY = Math.round((frameH - imgH) / 2);

      if (frameMode === 'white' || frameMode === 'blur') {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.12)';
        ctx.shadowBlur = 24;
        ctx.shadowOffsetY = 4;
      }
      ctx.drawImage(resizedImgCanvas, offsetX, offsetY);
      resizedImgCanvas.width = 0;
      resizedImgCanvas.height = 0;
    } else {
      const { width: targetW, height: targetH } = calculateTargetDimensions(
        origWidth,
        origHeight,
        targetLongEdge,
        true
      );
      finalCanvas = await resizeCanvasHighQuality(sourceCanvas, targetW, targetH);
      finalCanvas = compositeBackground(finalCanvas, '#ffffff');
    }

    const maxBytes = 10 * 1024 * 1024;
    let quality = 0.94;
    let compressedBlob = await canvasToBlob(finalCanvas, 'image/jpeg', quality);

    while (compressedBlob.size > maxBytes && quality > 0.65) {
      quality -= 0.05;
      compressedBlob = await canvasToBlob(finalCanvas, 'image/jpeg', quality);
    }

    if (preserveExif) {
      compressedBlob = await attachExifToJpeg(compressedBlob, file);
    }

    const preview = URL.createObjectURL(compressedBlob);
    const ratio = ((1 - compressedBlob.size / file.size) * 100).toFixed(1);

    return {
      success: true,
      isSplit: false,
      file: compressedBlob,
      preview,
      format: 'jpg',
      originalSize: file.size,
      compressedSize: compressedBlob.size,
      originalWidth: origWidth,
      originalHeight: origHeight,
      outputWidth: finalCanvas.width,
      outputHeight: finalCanvas.height,
      ratio,
      warning,
      exif: exifSummary,
    };
  } catch (error) {
    console.error('Instagram processing failed:', error);
    return { success: false, error: error.message || '인스타그램 이미지 변환에 실패했습니다.' };
  } finally {
    if (sourceCanvas) { sourceCanvas.width = 0; sourceCanvas.height = 0; }
    if (finalCanvas) { finalCanvas.width = 0; finalCanvas.height = 0; }
    if (compositeCanvas) { compositeCanvas.width = 0; compositeCanvas.height = 0; }
  }
};

/**
 * Helper to convert canvas to blob promise.
 */
function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas to Blob 변환에 실패했습니다.'));
    }, mimeType, quality);
  });
}

/**
 * TIFF or DNG to PNG Blob converter.
 */
const convertTiffOrDngToBlob = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const buffer = e.target.result;
      const nameLower = file.name.toLowerCase();

      // For DNG files, prioritize extracting the embedded full JPEG preview
      if (nameLower.endsWith('.dng')) {
        const carvedBlob = extractLargestJpegFromDng(buffer);
        if (carvedBlob) {
          resolve(carvedBlob);
          return;
        }
      }

      try {
        const ifds = UTIF.decode(buffer);
        if (ifds && ifds.length > 0) {
          const sortedIfds = [...ifds]
            .map((ifd, index) => ({ ifd, index }))
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

          if (selectedIfd && rgba) {
            const canvas = document.createElement('canvas');
            canvas.width = selectedIfd.width;
            canvas.height = selectedIfd.height;
            const ctx = canvas.getContext('2d');
            const imgData = ctx.createImageData(canvas.width, canvas.height);
            imgData.data.set(rgba);
            ctx.putImageData(imgData, 0, 0);

            canvas.toBlob((blob) => {
              canvas.width = 0;
              canvas.height = 0;
              if (blob) resolve(blob);
              else {
                const carvedBlob = extractLargestJpegFromDng(buffer);
                if (carvedBlob) resolve(carvedBlob);
                else reject(new Error('Canvas to Blob 변환 실패'));
              }
            }, 'image/png');
            return;
          }
        }
      } catch (err) {
        console.warn('UTIF decoding failed:', err);
      }

      const carvedBlob = extractLargestJpegFromDng(buffer);
      if (carvedBlob) resolve(carvedBlob);
      else reject(new Error('이미지를 디코딩할 수 없거나 유효한 미리보기 이미지를 찾을 수 없습니다.'));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
};

/**
 * Extracts the largest embedded JPEG from DNG buffer safely without freezing.
 */
const extractLargestJpegFromDng = (arrayBuffer) => {
  const bytes = new Uint8Array(arrayBuffer);
  let largestJpeg = null;
  let maxLen = 0;
  const len = bytes.length;

  for (let i = 0; i < len - 4; i++) {
    // SOI marker: 0xFF, 0xD8, 0xFF
    if (bytes[i] === 0xFF && bytes[i + 1] === 0xD8 && bytes[i + 2] === 0xFF) {
      // Find EOI marker with reasonable step
      for (let j = i + 1024; j < len - 1; j++) {
        if (bytes[j] === 0xFF && bytes[j + 1] === 0xD9) {
          const segLen = j + 2 - i;
          if (segLen > maxLen) {
            maxLen = segLen;
            largestJpeg = bytes.subarray(i, i + segLen);
          }
          i = j + 1; // skip ahead
          break;
        }
      }
    }
  }

  if (largestJpeg) {
    return new Blob([largestJpeg], { type: 'image/jpeg' });
  }
  return null;
};

/**
 * HEIC to PNG Blob converter.
 */
const convertHeicToBlob = async (file) => {
  const heic2anyModule = await import('heic2any');
  const heic2any = heic2anyModule.default || heic2anyModule;
  const result = await heic2any({
    blob: file,
    toType: 'image/png'
  });
  return Array.isArray(result) ? result[0] : result;
};
