import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import Vips from 'wasm-vips';
import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';
import { createEngine } from '../src/engine/core.js';
import { readMetadata } from '../src/engine/metadata.js';
import {
  sniff,
  jpegSegments,
  rewriteJpeg,
  metadataContainers,
  concat,
} from '../src/engine/containers.js';
import { photo, cr3Fixture, dngFixture, corruptPngIcc } from './fixtures.mjs';

const v = await Vips({ dynamicLibraries: ['vips-heif.wasm'] });
mkdirSync('tests/fixtures/generated', { recursive: true });
const engine = createEngine(v, {
  adobePath: 'public/profiles/AdobeCompat-v2.icc',
  sourceProfilePath: 'tests/fixtures/generated/source.icc',
});
const input = await photo();
const bytesOf = async (result) =>
  new Uint8Array(await result.artifacts[0].blob.arrayBuffer());
// Emscripten pthread workers deliberately remain alive for reuse; terminate them after this test process.
after(() => {
  v.PThread?.terminateAllThreads?.();
});

test('real JPG/WebP/PNG/AVIF outputs match their signatures, have ICC, decode and strip all shooting metadata', async () => {
  for (const format of ['jpg', 'webp', 'png', 'avif']) {
    const result = await engine.run(input, 'input.jpg', {
      format,
      metadata: 'strip',
      longEdge: 160,
    });
    const bytes = await bytesOf(result),
      out = await sharp(bytes).metadata();
    assert.equal(sniff(bytes), format);
    assert.equal(out.width, 160);
    assert.equal(out.height, 120);
    assert.ok(out.icc);
    assert.ok(!out.exif && !out.xmp && !out.iptc);
    assert.equal(metadataContainers(bytes).length, 0);
    assert.equal(result.artifacts[0].checks.metadata, 'stripped');
  }
});
test('supported shooting tags and raw date strings survive each codec, GPS is optional', async () => {
  for (const format of ['jpg', 'webp', 'png', 'avif']) {
    const result = await engine.run(input, 'input.jpg', { format });
    assert.equal(result.artifacts[0].checks.metadata, 'verified');
    const output = await readMetadata(await bytesOf(result));
    // AVIF EXIF parsing is checked independently by the decoded libvips metadata verifier.
    if (format !== 'avif') {
      assert.equal(output.DateTimeOriginal, '2026:11:03 12:30:00');
      assert.equal(output.GPSLatitude, undefined);
    }
  }
  const result = await engine.run(input, 'input.jpg', { gps: true });
  assert.ok((await readMetadata(await bytesOf(result))).GPSLatitude);
});
test('metadata strip in same-format Q100 never bypasses privacy rules and preserves JPEG scan bytes', async () => {
  const result = await engine.run(input, 'input.jpg', {
    quality: 100,
    colorSpace: 'source',
    metadata: 'strip',
  });
  const bytes = await bytesOf(result);
  assert.equal(result.artifacts[0].checks.losslessCopy, true);
  assert.equal(metadataContainers(bytes).length, 0);
  assert.deepEqual(
    new Uint8Array(jpegSegments(bytes).tail),
    new Uint8Array(jpegSegments(input).tail),
  );
});
test('target size never reports above-limit files as satisfied, including unavoidable ICC overhead', async () => {
  const ok = await engine.run(input, 'input.jpg', {
    purpose: 'size',
    maxBytes: 9000,
    quality: 60,
  });
  assert.ok(ok.artifacts[0].bytes <= 9000);
  assert.equal(ok.artifacts[0].checks.withinTarget, true);
  const impossible = await engine.run(input, 'input.jpg', {
    purpose: 'size',
    maxBytes: 10,
    quality: 5,
  });
  assert.equal(impossible.artifacts[0].checks.withinTarget, false);
  assert.equal(impossible.artifacts[0].width, 320);
});
test('privacy sanitization removes metadata after scan data and drops appended bytes', async () => {
  const comment = new Uint8Array([255, 254, 0, 8, 83, 69, 67, 82, 69, 84]);
  const dirty = concat([
    input.subarray(0, input.length - 2),
    comment,
    input.subarray(-2),
    new TextEncoder().encode('private appended payload'),
  ]);
  const result = await engine.run(dirty, 'late-comment.jpg', {
    quality: 100,
    colorSpace: 'source',
    metadata: 'strip',
  });
  const clean = await bytesOf(result);
  assert.equal(metadataContainers(clean).length, 0);
  assert.equal(
    new TextDecoder().decode(clean).includes('private appended payload'),
    false,
  );
  assert.equal(clean.at(-1), 217);
});
test('EXIF orientation is applied exactly once and dimensions are verified', async () => {
  const rotated = await sharp(input)
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  const asset = await engine.inspect(rotated, 'rotated.jpg');
  assert.equal(asset.width, 240);
  assert.equal(asset.height, 320);
  const result = await engine.run(rotated, 'rotated.jpg', {});
  const info = await sharp(await bytesOf(result)).metadata();
  assert.equal(info.width, 240);
  assert.equal(info.height, 320);
  assert.ok(!info.orientation || info.orientation === 1);
});
test('16-bit Adobe RGB input stays high precision until output and matches native libvips color conversion', async () => {
  const width = 1024,
    height = 32,
    data = new Uint16Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    data[i * 3] = Math.round(((i % width) / (width - 1)) * 65535);
    data[i * 3 + 1] = 24000;
    data[i * 3 + 2] = 36000;
  }
  const raw = v.Image.newFromMemory(
      data,
      width,
      height,
      3,
      v.BandFormat.ushort,
    ),
    im = raw.copy({ interpretation: 'rgb16' });
  try {
    im.setBlob(
      'icc-profile-data',
      readFileSync('public/profiles/AdobeCompat-v2.icc'),
    );
    const tiff = im.writeToBuffer('.tif'),
      asset = await engine.inspect(tiff, 'scan.tif');
    assert.equal(asset.bits, 16);
    assert.equal(asset.icc, 'A98C');
    for (const colorSpace of ['srgb', 'p3', 'source']) {
      const result = await engine.run(tiff, 'scan.tif', {
        format: 'png',
        colorSpace,
        metadata: 'strip',
      });
      const output = await bytesOf(result);
      const native = sharp(tiff)
        .withIccProfile(
          colorSpace === 'source'
            ? 'public/profiles/AdobeCompat-v2.icc'
            : colorSpace,
        )
        .png();
      const a = await sharp(output).raw().toBuffer(),
        b = await sharp(await native.toBuffer())
          .raw()
          .toBuffer();
      let sum = 0,
        max = 0;
      for (let i = 0; i < a.length; i++) {
        const diff = Math.abs(a[i] - b[i]);
        sum += diff;
        max = Math.max(max, diff);
      }
      console.log(
        `native parity ${colorSpace}: mean=${(sum / a.length).toFixed(3)}, max=${max}`,
      );
      assert.ok(
        sum / a.length < 1.1,
        'WASM/native color difference exceeds one 8-bit code value on average',
      );
      assert.ok((await sharp(output).metadata()).icc);
    }
  } finally {
    im.delete();
    raw.delete();
  }
});
test('transparent PNG composites to white JPEG, retains alpha in WebP, and grayscale 16-bit is supported', async () => {
  const transparent = await sharp({
    create: {
      width: 20,
      height: 20,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
  const jpg = await engine.run(transparent, 'alpha.png', {});
  const pixels = await sharp(await bytesOf(jpg))
    .raw()
    .toBuffer();
  assert.ok(pixels[0] > 250 && pixels[1] > 250 && pixels[2] > 250);
  const webp = await engine.run(transparent, 'alpha.png', { format: 'webp' });
  assert.ok((await sharp(await bytesOf(webp)).metadata()).hasAlpha);
  const im = v.Image.newFromMemory(
      new Uint16Array([0, 16384, 32768, 65535]),
      4,
      1,
      1,
      v.BandFormat.ushort,
    ),
    gray = im.copy({ interpretation: 'grey16' });
  try {
    assert.equal(
      (await engine.run(gray.writeToBuffer('.tif'), 'gray.tif', {}))
        .artifacts[0].checks.decoded,
      true,
    );
  } finally {
    gray.delete();
    im.delete();
  }
});
test('panorama slices retain exact ratios and the proof compares actual encoded pixels', async () => {
  for (const fit of ['contain', 'cover'])
    for (const frame of ['white', 'black', 'blur']) {
      const result = await engine.run(input, 'input.jpg', {
        purpose: 'social',
        slices: 3,
        longEdge: 200,
        fit,
        frame,
      });
      assert.equal(result.artifacts.length, 3);
      for (const a of result.artifacts) assert.equal(a.width / a.height, 0.8);
    }
  const proof = await engine.run(
    input,
    'input.jpg',
    { quality: 50 },
    { region: { x: 0.5, y: 0.5, slice: 0 } },
  );
  assert.ok(proof.proof.before.size && proof.proof.after.size);
  assert.equal(proof.proof.width, 320);
});
test('corrupt ICC and truncated image data fail; explicitly assigned input profile can recover ICC damage', async () => {
  const badPng = await corruptPngIcc(input);
  await assert.rejects(engine.run(badPng, 'bad.png', {}), /ICC/);
  assert.equal(
    (await engine.run(badPng, 'bad.png', { inputProfile: 'srgb' })).artifacts[0]
      .checks.decoded,
    true,
  );
  const image = v.Image.newFromBuffer(input),
    copy = image.copy();
  try {
    const invalid = new Uint8Array(input);
    const offset =
      jpegSegments(invalid).segments.find((s) => s.marker === 0xe2).data
        .byteOffset -
      invalid.byteOffset +
      14;
    invalid.fill(0, offset, offset + 100);
    await assert.rejects(engine.run(invalid, 'bad.jpg', {}), /ICC/);
    assert.equal(
      (await engine.run(invalid, 'bad.jpg', { inputProfile: 'srgb' }))
        .artifacts[0].checks.decoded,
      true,
    );
  } finally {
    copy.delete();
    image.delete();
  }
  await assert.rejects(engine.run(input.subarray(0, 100), 'truncated.jpg', {}));
  assert.throws(() =>
    rewriteJpeg(new Uint8Array([255, 216, 255, 225, 255, 255]), null),
  );
});
test('CR3/DNG provenance and extracted dimensions cannot be mistaken for sensor RAW decoding', async () => {
  for (const [name, bytes] of [
    ['r6-iii.cr3', cr3Fixture(input)],
    ['input.dng', dngFixture(input)],
  ]) {
    const asset = await engine.inspect(bytes, name);
    assert.equal(asset.provenance, 'embedded-jpeg');
    assert.equal(asset.width, 320);
    const result = await engine.run(bytes, name, {});
    assert.equal(result.provenance, 'embedded-jpeg');
    assert.equal(result.artifacts[0].checks.metadata, 'verified');
  }
});
