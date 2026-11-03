import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import Vips from 'wasm-vips';
import sharp from 'sharp';
import { createEngine } from '../src/engine/core.js';
import { extractCr3 } from '../src/engine/rawPreview.js';
import { jpegDimensions } from '../src/engine/containers.js';
import { readMetadata } from '../src/engine/metadata.js';
const v = await Vips({ dynamicLibraries: ['vips-heif.wasm'] });
mkdirSync('tests/fixtures/generated', { recursive: true });
const engine = createEngine(v, {
  adobePath: 'public/profiles/AdobeCompat-v2.icc',
  sourceProfilePath: 'tests/fixtures/generated/source.icc',
});
after(() => v.PThread?.terminateAllThreads?.());
for (const item of JSON.parse(
  readFileSync('tests/camera-fixtures.json', 'utf8'),
)) {
  test(`real Canon EOS R6 Mark III: ${item.name}`, async () => {
    const bytes = readFileSync(`tests/fixtures/external/${item.name}`);
    const extracted = extractCr3(bytes),
      dims = jpegDimensions(extracted.bytes);
    assert.deepEqual(dims, { width: item.width, height: item.height });
    const asset = await engine.inspect(bytes, item.name);
    assert.equal(asset.provenance, 'embedded-jpeg');
    assert.equal(asset.metadata.Model, 'Canon EOS R6 Mark III');
    assert.ok(asset.metadata.DateTimeOriginal);
    assert.ok(asset.metadata.LensModel);
    const result = await engine.run(bytes, item.name, {
      longEdge: 2048,
      metadata: 'keep',
    });
    const savedMetadata = await readMetadata(
      new Uint8Array(await result.artifacts[0].blob.arrayBuffer()),
    );
    assert.equal(
      savedMetadata.DateTimeOriginal,
      asset.metadata.DateTimeOriginal,
    );
    assert.equal(savedMetadata.OffsetTimeOriginal, '-08:00');
    console.log(
      `${item.name}: ${dims.width}x${dims.height}, lens/date/timezone preserved`,
    );
    assert.equal(result.artifacts[0].checks.metadata, 'verified');
    assert.equal(result.artifacts[0].checks.decoded, true);
    const out = await sharp(
      new Uint8Array(await result.artifacts[0].blob.arrayBuffer()),
    ).metadata();
    assert.equal(out.width, 2048);
    assert.ok(out.icc);
  });
}
