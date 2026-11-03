import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRecipe,
  targetDimensions,
  socialGeometry,
  encodeWithinLimit,
} from '../src/engine/recipe.js';
import {
  archiveGroups,
  uniqueNames,
  fileTimestamp,
} from '../src/workspace/export.js';
import { extractCr3, extractDng } from '../src/engine/rawPreview.js';
import { sniff, jpegDimensions, concat } from '../src/engine/containers.js';
import { photo, cr3Fixture, dngFixture, box } from './fixtures.mjs';

test('recipes are frozen, validated and never upscale', () => {
  const recipe = normalizeRecipe({ metadata: 'strip', gps: true });
  assert.ok(Object.isFrozen(recipe));
  assert.equal(recipe.gps, false);
  assert.throws(() => normalizeRecipe({ longEdge: NaN }));
  assert.throws(() => normalizeRecipe({ format: 'gif' }));
  assert.deepEqual(targetDimensions(400, 600, 2048), {
    width: 400,
    height: 600,
  });
  assert.deepEqual(targetDimensions(6000, 4000, 2048), {
    width: 2048,
    height: 1365,
  });
});
test('panorama dimensions keep exact 4:5 tiles and avoid scaling small photos up', () => {
  for (const slices of [2, 3])
    for (const fit of ['contain', 'cover']) {
      const g = socialGeometry(
        360,
        240,
        normalizeRecipe({ purpose: 'social', slices, fit }),
      );
      assert.equal(g.width / slices / g.height, 0.8);
      assert.ok(g.imageWidth <= 360 && g.imageHeight <= 240);
      assert.equal(g.width % slices, 0);
    }
});
test('target size includes all bytes and selects highest passing integer quality even for non-monotonic encoders', async () => {
  const result = await encodeWithinLimit(
    (q) => new Uint8Array(q === 83 ? 999 : q * 20),
    1000,
    95,
  );
  assert.equal(result.quality, 83);
  assert.equal(result.withinTarget, true);
  const failed = await encodeWithinLimit(() => new Uint8Array(1001), 1000, 3);
  assert.equal(failed.withinTarget, false);
});
test('ZIP names cannot overwrite equal names and archives respect their byte budget', () => {
  assert.equal(
    fileTimestamp(new Date(2026, 10, 3, 9, 8, 7)),
    '20261103_090807',
  );
  const names = uniqueNames(
    ['A.jpg', 'a.tif', 'a.webp'].map((name) => ({ name, format: 'jpg' })),
  );
  assert.equal(new Set(names.map((x) => x.outputName.toLowerCase())).size, 3);
  assert.deepEqual(
    archiveGroups(
      [{ bytes: 6 }, { bytes: 6 }, { bytes: 20 }, { bytes: 2 }],
      10,
    ).map((g) => g.reduce((n, x) => n + x.bytes, 0)),
    [6, 6, 20, 2],
  );
});
test('CR3 selects full JPEG track over smaller PRVW by pixel dimensions, and reads CMT metadata', async () => {
  const large = await photo(640, 480),
    small = await photo(160, 120);
  const fixture = cr3Fixture(large, small),
    result = extractCr3(fixture);
  assert.equal(sniff(fixture), 'cr3');
  assert.deepEqual(jpegDimensions(result.bytes), { width: 640, height: 480 });
  assert.ok(result.metadata.length);
  const broken = fixture.slice();
  new DataView(broken.buffer).setUint32(0, 0xffffffff);
  assert.throws(() => extractCr3(broken));
  const noPreview = concat([
    box('ftyp', new TextEncoder().encode('crx \0\0\0\0')),
    box('mdat', large),
  ]);
  assert.throws(() => extractCr3(noPreview), /내장 JPEG/);
});
test('DNG extracts only a referenced JPEG and rejects absent or invalid previews', async () => {
  const jpeg = await photo(100, 80);
  assert.deepEqual(jpegDimensions(extractDng(dngFixture(jpeg)).bytes), {
    width: 100,
    height: 80,
  });
  const invalid = dngFixture(jpeg);
  new DataView(invalid.buffer).setUint32(18, 0xfffffff0, true);
  assert.throws(() => extractDng(invalid));
});
