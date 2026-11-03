import {
  sniff,
  textAt,
  viewOf,
  rewriteJpeg,
  rewriteWebp,
  metadataContainers,
  containerIcc,
} from './containers.js';
import { extractCr3, extractDng } from './rawPreview.js';
import {
  readMetadata,
  readCmt,
  buildExif,
  verifyShotMetadata,
} from './metadata.js';
import {
  normalizeRecipe,
  targetDimensions,
  socialGeometry,
  encodeWithinLimit,
} from './recipe.js';

const MIME = {
  jpg: 'image/jpeg',
  webp: 'image/webp',
  png: 'image/png',
  avif: 'image/avif',
};
const fields = (image) => {
  const vector = image.getFields();
  try {
    return [...vector];
  } finally {
    vector.delete();
  }
};
const integer = (image, key, fallback = 0) =>
  image.getTypeof(key) ? image.getInt(key) : fallback;
const blobField = (image, key) =>
  image.getTypeof(key) ? new Uint8Array(image.getBlob(key)) : null;

export function describeIcc(bytes) {
  if (!bytes) return '없음 · sRGB 가정';
  const v = viewOf(bytes);
  if (
    bytes.length < 132 ||
    textAt(bytes, 36, 4) !== 'acsp' ||
    v.getUint32(0) > bytes.length
  )
    throw new Error(
      '손상된 ICC 프로파일입니다. 입력 프로파일을 직접 지정하세요.',
    );
  const count = v.getUint32(128);
  if (count > 10000 || 132 + count * 12 > bytes.length)
    throw new Error('ICC 태그 테이블이 손상되었습니다.');
  let label = '내장 ICC';
  for (let i = 0; i < count; i++) {
    const at = 132 + i * 12,
      pos = v.getUint32(at + 4),
      size = v.getUint32(at + 8);
    if (pos + size > bytes.length)
      throw new Error('ICC 태그 범위가 올바르지 않습니다.');
    if (textAt(bytes, at, 4) !== 'desc' || size < 12) continue;
    if (textAt(bytes, pos, 4) === 'desc')
      label = textAt(
        bytes,
        pos + 12,
        Math.min(v.getUint32(pos + 8), size - 12),
      ).replace(/\0/g, '');
    if (textAt(bytes, pos, 4) === 'mluc' && size >= 28) {
      const len = v.getUint32(pos + 20),
        off = v.getUint32(pos + 24);
      if (off + len <= size)
        label = new TextDecoder('utf-16be').decode(
          bytes.subarray(pos + off, pos + off + len),
        );
    }
  }
  return label || '내장 ICC';
}

class Handles {
  items = [];
  add(image) {
    this.items.push(image);
    return image;
  }
  close() {
    for (const image of this.items.reverse()) image.delete();
  }
}

/** The same engine runs in browser Workers and Node regression tests. No DOM or Canvas. */
export function createEngine(
  vips,
  {
    adobePath = '/adobe.icc',
    sourceProfilePath = '/source.icc',
    maxPixels = 200000000,
  } = {},
) {
  vips.concurrency(2);
  vips.Cache.max(0);
  vips.Cache.maxMem(32 * 1024 * 1024);

  async function open(bytes, name, handles, convertedBytes) {
    const original = bytes,
      actualFormat = sniff(bytes),
      warnings = [];
    let provenance = 'original',
      extra = [];
    if (actualFormat === 'cr3' || name.toLowerCase().endsWith('.dng')) {
      const extracted =
        actualFormat === 'cr3' ? extractCr3(bytes) : extractDng(bytes);
      bytes = extracted.bytes;
      extra = extracted.metadata;
      provenance = 'embedded-jpeg';
      warnings.push(
        'RAW 내장 JPEG 기반입니다. 센서 RAW 현상이나 고비트 원본 변환이 아닙니다.',
      );
    } else if (actualFormat === 'heic') {
      if (!convertedBytes)
        throw new Error(
          'HEIC 8비트 디코더를 준비할 수 없습니다. JPG/TIFF 보정본을 사용하세요.',
        );
      bytes = convertedBytes;
      provenance = 'heic-8bit';
      warnings.push(
        'HEIC 보조 디코더는 8비트 출력입니다. 원본 광색역·HDR 보존을 보장하지 않습니다.',
      );
    }
    if (!['jpg', 'png', 'webp', 'avif', 'tiff'].includes(sniff(bytes)))
      throw new Error(
        '지원하지 않는 파일입니다. JPG, TIFF, PNG, WebP, AVIF, HEIC, CR3, DNG를 선택하세요.',
      );
    const metadata = {
      ...(await readMetadata(original)),
      ...(await readMetadata(bytes)),
    };
    for (const item of extra)
      Object.assign(
        metadata,
        await readMetadata(item.bytes),
        readCmt(item.bytes, item.isGps),
      );
    const source = handles.add(
      vips.Image.newFromBuffer(bytes, '', {
        access: 'random',
        fail_on: 'error',
      }),
    );
    const engineExif = blobField(source, 'exif-data');
    if (engineExif) Object.assign(metadata, await readMetadata(engineExif));
    if (source.width * source.height > maxPixels)
      throw new Error(
        `이 기기의 안전 처리 한도(${Math.round(maxPixels / 1000000)}MP)를 초과합니다. PC 또는 더 작은 보정본을 사용하세요.`,
      );
    if (integer(source, 'n-pages', 1) > 1)
      throw new Error(
        '다중 페이지·애니메이션 이미지는 지원하지 않습니다. 사용할 한 장을 내보내 주세요.',
      );
    if (!['uchar', 'ushort'].includes(source.format))
      throw new Error(
        '부동소수점/HDR 입력은 아직 지원하지 않습니다. SDR TIFF/JPG를 사용하세요.',
      );
    if (
      !['srgb', 'rgb', 'rgb16', 'b-w', 'grey16'].includes(source.interpretation)
    )
      throw new Error(
        `지원하지 않는 색상 모델(${source.interpretation})입니다. RGB 보정본을 사용하세요.`,
      );
    if (
      source.gainmap ||
      [16, 18].includes(integer(source, 'heif-transfer-characteristics'))
    )
      throw new Error('HDR 톤 매핑은 후속 지원입니다. SDR 사진을 사용하세요.');
    if (
      provenance === 'embedded-jpeg' &&
      !source.getTypeof('orientation') &&
      metadata.Orientation
    )
      source.setInt('orientation', metadata.Orientation);
    const orientation = integer(source, 'orientation', 1);
    const upright = handles.add(source.autorot());
    let icc, iccError;
    try {
      icc = await containerIcc(bytes);
    } catch (error) {
      iccError = String(error.message || error);
    }
    icc ||= blobField(source, 'icc-profile-data');
    let iccName;
    try {
      iccName = iccError
        ? '손상된 ICC · 입력 프로파일 지정 필요'
        : describeIcc(icc);
    } catch {
      iccName = '손상된 ICC · 입력 프로파일 지정 필요';
    }
    if (!icc)
      warnings.push(
        '내장 ICC가 없습니다. 기본적으로 sRGB로 해석합니다. 필요하면 입력 프로파일을 지정하세요.',
      );
    return {
      source: upright,
      bytes,
      metadata,
      icc,
      iccError,
      iccName,
      orientation,
      provenance,
      warnings,
      format: sniff(bytes),
      width: upright.width,
      height: upright.height,
      bits: source.format === 'ushort' ? 16 : 8,
    };
  }

  function colorPipeline(input, recipe, handles) {
    let icc = input.icc;
    const assigned = recipe.inputProfile !== 'auto';
    if (input.iccError && !assigned)
      throw new Error(
        `ICC 읽기 검증 실패: ${input.iccError} 입력 프로파일을 직접 지정하세요.`,
      );
    if (icc && !assigned) {
      describeIcc(icc);
      if (!['RGB ', 'GRAY'].includes(textAt(icc, 16, 4)))
        throw new Error('RGB/회색 ICC만 지원합니다. RGB 보정본을 사용하세요.');
      input.source.setBlob('icc-profile-data', icc);
    } else icc = null;
    const inputProfile =
      recipe.inputProfile === 'adobergb'
        ? adobePath
        : assigned
          ? recipe.inputProfile
          : input.source.bands <= 2
            ? 'sgrey'
            : 'srgb';
    const working = handles.add(
      input.source.iccImport({
        pcs: 'xyz',
        embedded: !assigned,
        input_profile: inputProfile,
        intent: 'relative',
        black_point_compensation: true,
      }),
    );
    let outputProfile = recipe.colorSpace === 'p3' ? 'p3' : 'srgb';
    if (recipe.colorSpace === 'source') {
      if (icc && textAt(icc, 16, 4) !== 'RGB ')
        throw new Error(
          '원본 ICC 유지는 RGB 사진에 사용할 수 있습니다. 이 입력은 sRGB 또는 Display P3 출력을 선택하세요.',
        );
      if (icc && textAt(icc, 16, 4) === 'RGB ') {
        vips.FS.writeFile(sourceProfilePath, icc);
        outputProfile = sourceProfilePath;
      } else if (assigned) outputProfile = inputProfile;
    }
    return { working, outputProfile };
  }

  function resize(image, width, height, handles) {
    if (image.width === width && image.height === height) return image;
    let result = image;
    if (image.hasAlpha()) result = handles.add(result.premultiply());
    result = handles.add(
      result.resize(width / result.width, {
        vscale: height / result.height,
        kernel: 'lanczos3',
      }),
    );
    if (image.hasAlpha()) result = handles.add(result.unpremultiply());
    return result;
  }

  function render(input, recipe, handles, preview = false) {
    const { working, outputProfile } = colorPipeline(input, recipe, handles);
    let geometry =
      recipe.purpose === 'social'
        ? socialGeometry(input.width, input.height, recipe)
        : null;
    if (
      recipe.purpose === 'social' &&
      recipe.frame === 'none' &&
      recipe.slices === 1
    )
      geometry = null;
    const dims = geometry
      ? { width: geometry.imageWidth, height: geometry.imageHeight }
      : targetDimensions(input.width, input.height, recipe.longEdge);
    if (
      !preview &&
      (geometry?.width || dims.width) * (geometry?.height || dims.height) >
        maxPixels
    )
      throw new Error(
        '여백을 포함한 출력 크기가 이 기기의 안전 처리 한도를 초과합니다. 장축 길이를 줄여주세요.',
      );
    const factor = preview
      ? Math.min(
          1,
          1200 /
            Math.max(
              geometry?.width || dims.width,
              geometry?.height || dims.height,
            ),
        )
      : 1;
    const iw = Math.max(1, Math.round(dims.width * factor)),
      ih = Math.max(1, Math.round(dims.height * factor));
    const resized = resize(working, iw, ih, handles);
    let output = handles.add(
      resized.iccExport({
        pcs: 'xyz',
        output_profile: outputProfile,
        intent: 'relative',
        black_point_compensation: true,
        depth: 16,
      }),
    );
    if (geometry) {
      const w = Math.max(
          recipe.slices,
          Math.round((geometry.width * factor) / recipe.slices) * recipe.slices,
        ),
        h = Math.max(1, Math.round(geometry.height * factor));
      const x = Math.round((w - output.width) * recipe.cropX),
        y = Math.round((h - output.height) * recipe.cropY);
      if (recipe.frame === 'blur' && recipe.fit === 'contain') {
        const scale = Math.max(w / output.width, h / output.height);
        let bg = handles.add(output.resize(scale, { kernel: 'lanczos3' }));
        bg = handles.add(
          bg.crop(
            Math.max(0, Math.floor((bg.width - w) / 2)),
            Math.max(0, Math.floor((bg.height - h) / 2)),
            w,
            h,
          ),
        );
        bg = handles.add(bg.gaussblur(Math.max(1, 24 * factor)));
        if (bg.hasAlpha())
          bg = handles.add(bg.flatten({ background: [65535, 65535, 65535] }));
        output = handles.add(bg.composite2(output, 'over', { x, y }));
      } else
        output = handles.add(
          output.embed(x, y, w, h, {
            extend: 'background',
            background:
              recipe.frame === 'black' ? [0, 0, 0] : [65535, 65535, 65535],
          }),
        );
    }
    const profile = blobField(output, 'icc-profile-data');
    if (!profile) throw new Error('출력 ICC 생성에 실패했습니다.');
    if (recipe.format === 'jpg' && output.hasAlpha())
      output = handles.add(
        output.flatten({ background: [65535, 65535, 65535] }),
      );
    output = handles.add(output.linear(1 / 257, 0));
    output = handles.add(output.round('rint'));
    output = handles.add(output.cast('uchar'));
    output = handles.add(output.copy({ interpretation: 'srgb' }));
    for (const key of fields(output))
      if (/exif|xmp|iptc|comment|photoshop/i.test(key)) output.remove(key);
    output.setBlob('icc-profile-data', profile);
    return { output, count: geometry ? recipe.slices : 1, profile };
  }

  async function encode(image, recipe, input, quality) {
    const exif = buildExif(input.metadata, recipe, image.width, image.height);
    if (exif && !['jpg', 'webp'].includes(recipe.format))
      image.setBlob('exif-data', exif);
    else image.remove('exif-data');
    const keep = 8 | (exif && !['jpg', 'webp'].includes(recipe.format) ? 1 : 0);
    let bytes;
    if (recipe.format === 'jpg')
      bytes = image.jpegsaveBuffer({
        Q: quality,
        optimize_coding: true,
        subsample_mode: 'off',
        keep,
      });
    if (recipe.format === 'webp')
      bytes = image.webpsaveBuffer({
        Q: quality,
        effort: 4,
        smart_subsample: true,
        keep,
      });
    if (recipe.format === 'png')
      bytes = image.pngsaveBuffer({ bitdepth: 8, keep });
    if (recipe.format === 'avif')
      bytes = image.heifsaveBuffer({
        compression: 'av1',
        Q: quality,
        effort: 4,
        bitdepth: 8,
        keep,
      });
    // Container rewrites apply exactly the same sanitization to passthrough and encoded images.
    if (recipe.format === 'jpg') bytes = rewriteJpeg(bytes, exif);
    if (recipe.format === 'webp')
      bytes = rewriteWebp(
        bytes,
        exif,
        image.width,
        image.height,
        image.hasAlpha(),
      );
    return bytes;
  }

  async function verify(
    bytes,
    recipe,
    input,
    width,
    height,
    quality,
    handles,
    losslessCopy = false,
  ) {
    if (sniff(bytes) !== recipe.format)
      throw new Error('실제 출력 포맷과 요청한 포맷이 다릅니다.');
    const image = handles.add(
      vips.Image.newFromBuffer(bytes, '', { fail_on: 'error' }),
    );
    if (image.width !== width || image.height !== height)
      throw new Error('출력 해상도 검증에 실패했습니다.');
    // Force decoding, rather than accepting a readable header as proof of an intact file.
    image.avg();
    const icc = blobField(image, 'icc-profile-data');
    if (!icc) throw new Error('출력 파일의 ICC가 누락되었습니다.');
    const iccName = describeIcc(icc);
    if (
      recipe.metadata === 'strip' &&
      (metadataContainers(bytes).length ||
        fields(image).some((f) =>
          /^(exif-|xmp-data|iptc-data|photoshop-data|comment)/i.test(f),
        ))
    )
      throw new Error('촬영정보 컨테이너 제거 검증에 실패했습니다.');
    const outputMetadata = await readMetadata(
      blobField(image, 'exif-data') || bytes,
    );
    const metadata = verifyShotMetadata(input.metadata, outputMetadata, recipe);
    return {
      blob: new Blob([bytes], { type: MIME[recipe.format] }),
      format: recipe.format,
      width,
      height,
      bytes: bytes.length,
      quality,
      checks: {
        signature: true,
        decoded: true,
        icc: iccName,
        metadata,
        withinTarget:
          recipe.purpose !== 'size' || bytes.length <= recipe.maxBytes,
        losslessCopy,
      },
    };
  }

  return {
    async inspect(bytes, name, convertedBytes) {
      const handles = new Handles();
      try {
        const input = await open(bytes, name, handles, convertedBytes);
        let thumbnail = null;
        try {
          const { output } = render(
            input,
            normalizeRecipe({
              longEdge: 480,
              format: 'webp',
              metadata: 'strip',
            }),
            handles,
            true,
          );
          thumbnail = new Blob(
            [output.webpsaveBuffer({ Q: 75, keep: vips.ForeignKeep.icc })],
            { type: 'image/webp' },
          );
        } catch (error) {
          input.warnings.push(
            `미리보기 제한: ${String(error.message || error)}`,
          );
        }
        return {
          name,
          format: sniff(bytes),
          width: input.width,
          height: input.height,
          bits: input.bits,
          icc: input.iccName,
          metadata: input.metadata,
          provenance: input.provenance,
          warnings: input.warnings,
          thumbnail,
        };
      } finally {
        handles.close();
      }
    },
    async run(
      bytes,
      name,
      value,
      { preview = false, convertedBytes, region } = {},
    ) {
      const started = performance.now(),
        recipe = normalizeRecipe(value),
        handles = new Handles();
      try {
        const input = await open(bytes, name, handles, convertedBytes);
        const canCopy =
          !preview &&
          !region &&
          ['jpg', 'webp'].includes(recipe.format) &&
          input.format === recipe.format &&
          recipe.purpose !== 'social' &&
          !recipe.longEdge &&
          recipe.quality === 100 &&
          recipe.inputProfile === 'auto' &&
          recipe.colorSpace === 'source' &&
          input.orientation === 1 &&
          input.icc;
        let artifacts, proof;
        if (
          canCopy &&
          (recipe.purpose !== 'size' || input.bytes.length <= recipe.maxBytes)
        ) {
          const exif = buildExif(
            input.metadata,
            recipe,
            input.width,
            input.height,
          );
          const bytes =
            recipe.format === 'jpg'
              ? rewriteJpeg(input.bytes, exif)
              : rewriteWebp(
                  input.bytes,
                  exif,
                  input.width,
                  input.height,
                  input.source.hasAlpha(),
                );
          artifacts = [
            await verify(
              bytes,
              recipe,
              input,
              input.width,
              input.height,
              null,
              handles,
              true,
            ),
          ];
        } else {
          const { output, count } = render(input, recipe, handles, preview);
          artifacts = [];
          for (let i = 0; i < count; i++) {
            const image =
              count > 1
                ? handles.add(
                    output.crop(
                      (i * output.width) / count,
                      0,
                      output.width / count,
                      output.height,
                    ),
                  )
                : output;
            if (preview) {
              const bytes = image.webpsaveBuffer({
                Q: 82,
                keep: vips.ForeignKeep.icc,
              });
              artifacts.push({
                blob: new Blob([bytes], { type: 'image/webp' }),
                width: image.width,
                height: image.height,
              });
            } else {
              const encodeAt = (q) => encode(image, recipe, input, q);
              const encoded =
                recipe.purpose === 'size' && recipe.format !== 'png'
                  ? await encodeWithinLimit(
                      encodeAt,
                      recipe.maxBytes,
                      recipe.quality,
                    )
                  : {
                      bytes: await encodeAt(recipe.quality),
                      quality: recipe.format === 'png' ? null : recipe.quality,
                    };
              artifacts.push(
                await verify(
                  encoded.bytes,
                  recipe,
                  input,
                  image.width,
                  image.height,
                  encoded.quality,
                  handles,
                ),
              );
              if (region && i === Math.min(count - 1, region.slice || 0)) {
                const width = Math.min(768, image.width),
                  height = Math.min(768, image.height);
                const left = Math.round(
                  (image.width - width) * Math.max(0, Math.min(1, region.x)),
                );
                const top = Math.round(
                  (image.height - height) * Math.max(0, Math.min(1, region.y)),
                );
                const reference = handles.add(
                  image.crop(left, top, width, height),
                );
                const decoded = handles.add(
                  vips.Image.newFromBuffer(encoded.bytes),
                );
                const tile = handles.add(
                  decoded.crop(left, top, width, height),
                );
                proof = {
                  before: new Blob([reference.pngsaveBuffer({ keep: 8 })], {
                    type: 'image/png',
                  }),
                  after: new Blob([tile.pngsaveBuffer({ keep: 8 })], {
                    type: 'image/png',
                  }),
                  width,
                  height,
                  left,
                  top,
                };
              }
            }
          }
        }
        const warnings = [...input.warnings];
        if (!preview && artifacts.some((a) => !a.checks.withinTarget))
          warnings.push(
            '목표 용량을 충족하지 못했습니다. 해상도를 줄이거나 다른 포맷을 선택하세요.',
          );
        if (!preview && artifacts.some((a) => a.checks.metadata === 'partial'))
          warnings.push(
            '일부 촬영정보를 보존하지 못했습니다. 결과 상세를 확인하세요.',
          );
        return {
          recipe,
          provenance: input.provenance,
          artifacts,
          warnings,
          proof,
          engine: `libvips ${vips.version()} / wasm-vips 0.0.19`,
          elapsedMs: performance.now() - started,
        };
      } finally {
        handles.close();
      }
    },
  };
}
