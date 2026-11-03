export const DEFAULT_RECIPE = Object.freeze({
  version: 1,
  purpose: 'quality',
  format: 'jpg',
  longEdge: 0,
  quality: 95,
  maxBytes: 2 * 1024 * 1024,
  colorSpace: 'srgb',
  inputProfile: 'auto',
  metadata: 'keep',
  gps: false,
  frame: 'white',
  slices: 1,
  fit: 'contain',
  cropX: 0.5,
  cropY: 0.5,
});

/** @returns {Readonly<import('./types').Recipe>} */
export function normalizeRecipe(value = {}) {
  const r = { ...DEFAULT_RECIPE, ...value, version: 1 };
  const member = (key, options) => {
    if (!options.includes(r[key])) throw new Error(`잘못된 설정: ${key}`);
  };
  member('purpose', ['quality', 'size', 'social']);
  member('format', ['jpg', 'webp', 'png', 'avif']);
  member('colorSpace', ['srgb', 'source', 'p3']);
  member('inputProfile', ['auto', 'srgb', 'p3', 'adobergb']);
  member('metadata', ['keep', 'strip']);
  member('frame', ['white', 'black', 'blur', 'none']);
  member('slices', [1, 2, 3]);
  member('fit', ['contain', 'cover']);
  for (const [key, min, max] of [
    ['longEdge', 0, 30000],
    ['quality', 1, 100],
    ['maxBytes', 1, 2 ** 31],
    ['cropX', 0, 1],
    ['cropY', 0, 1],
  ]) {
    if (!Number.isFinite(r[key]) || r[key] < min || r[key] > max)
      throw new Error(`설정 범위를 확인하세요: ${key}`);
  }
  r.longEdge = Math.round(r.longEdge);
  r.quality = Math.round(r.quality);
  r.gps = r.metadata === 'keep' && !!r.gps;
  return Object.freeze(r);
}

export function targetDimensions(width, height, longEdge) {
  const scale =
    longEdge > 0 ? Math.min(1, longEdge / Math.max(width, height)) : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

// A single composite geometry owns both the preview and the final slice boundaries.
export function socialGeometry(width, height, recipe) {
  const count = recipe.slices;
  const ratio =
    count > 1
      ? (count * 4) / 5
      : Math.max(4 / 5, Math.min(1.91, width / height));
  const edge = recipe.longEdge || Math.max(width, height);
  let h = count > 1 ? edge : Math.min(edge, edge / ratio);
  let w = h * ratio;
  const requestedScale =
    recipe.fit === 'cover'
      ? Math.max(w / width, h / height)
      : Math.min(w / width, h / height);
  if (requestedScale > 1) {
    w /= requestedScale;
    h /= requestedScale;
  }
  if (count > 1) {
    // Multiples of 4x5 yield exact ratios, integer seams, and no accumulated rounding.
    h = Math.max(5, Math.floor(h / 5) * 5);
    w = ((h * 4) / 5) * count;
  } else {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
  }
  const scale = Math.min(
    1,
    recipe.fit === 'cover'
      ? Math.max(w / width, h / height)
      : Math.min(w / width, h / height),
  );
  const iw = Math.max(1, Math.round(width * scale)),
    ih = Math.max(1, Math.round(height * scale));
  return {
    width: w,
    height: h,
    imageWidth: iw,
    imageHeight: ih,
    left: Math.round((w - iw) * recipe.cropX),
    top: Math.round((h - ih) * recipe.cropY),
    count,
  };
}

/** Exhaustive integer search avoids assuming that encoded size is monotonic in Q. */
export async function encodeWithinLimit(encode, maxBytes, maxQuality = 100) {
  let smallest;
  for (let quality = maxQuality; quality >= 1; quality--) {
    const bytes = await encode(quality);
    if (!smallest || bytes.length < smallest.bytes.length)
      smallest = { bytes, quality, withinTarget: false };
    if (bytes.length <= maxBytes) return { bytes, quality, withinTarget: true };
  }
  return smallest;
}
