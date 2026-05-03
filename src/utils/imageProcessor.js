import UTIF from 'utif';
import imageCompression from 'browser-image-compression';

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
