import sharp from 'sharp';
import piexif from 'piexifjs';
import { deflateSync } from 'node:zlib';
import { concat } from '../src/engine/containers.js';

export async function photo(width = 320, height = 240, profile = 'srgb') {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      pixels[i] = Math.round((x / Math.max(1, width - 1)) * 255);
      pixels[i + 1] = Math.round((y / Math.max(1, height - 1)) * 255);
      pixels[i + 2] = (x * 13 + y * 7) % 256;
    }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .withIccProfile(profile)
    .withExif({
      IFD0: {
        Make: 'Canon',
        Model: 'EOS R6 Mark III',
        Artist: 'Fixture',
        Copyright: 'Test only',
      },
      IFD2: {
        DateTimeOriginal: '2026:11:03 12:30:00',
        LensModel: 'RF35mm',
        ISOSpeedRatings: '400',
        FNumber: '28/10',
      },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '37/1 30/1 0/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '127/1 0/1 0/1',
      },
    })
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toBuffer();
}
export function box(type, ...parts) {
  const data = concat(parts),
    bytes = new Uint8Array(data.length + 8);
  new DataView(bytes.buffer).setUint32(0, bytes.length);
  bytes.set(new TextEncoder().encode(type), 4);
  bytes.set(data, 8);
  return bytes;
}
function words(...values) {
  const data = new Uint8Array(values.length * 4);
  values.forEach((n, i) => new DataView(data.buffer).setUint32(i * 4, n));
  return data;
}
export function cr3Fixture(jpeg, preview = jpeg) {
  const ftyp = box('ftyp', new TextEncoder().encode('crx \0\0\0\0crx '));
  const thumbnailHeader = new Uint8Array(16);
  new DataView(thumbnailHeader.buffer).setUint32(12, preview.length);
  const metadata = Uint8Array.from(
    piexif
      .dump({
        '0th': {
          [piexif.ImageIFD.Make]: 'Canon',
          [piexif.ImageIFD.Model]: 'EOS R6 Mark III',
        },
        Exif: {},
        GPS: {},
        '1st': {},
      })
      .slice(6),
    (c) => c.charCodeAt(0),
  );
  const canon = box(
    'uuid',
    Uint8Array.from('85c0b687820f11e08111f4ce462b6a48'.match(/../g), (x) =>
      parseInt(x, 16),
    ),
    box('CMT1', metadata),
  );
  function moov(offset) {
    return box(
      'moov',
      canon,
      box(
        'trak',
        box(
          'mdia',
          box(
            'minf',
            box(
              'stbl',
              box('stco', words(0, 1, offset)),
              box('stsz', words(0, 0, 1, jpeg.length)),
              box('stsc', words(0, 1, 1, 1, 1)),
            ),
          ),
        ),
      ),
    );
  }
  const previewBox = box(
    'uuid',
    Uint8Array.from('eaf42b5e1c984b88b9fbb7dc406e4d16'.match(/../g), (x) =>
      parseInt(x, 16),
    ),
    new Uint8Array(8),
    box('PRVW', thumbnailHeader, preview),
  );
  return concat([
    ftyp,
    moov(ftyp.length + moov(0).length + 8),
    box('mdat', jpeg),
    previewBox,
  ]);
}
export function dngFixture(jpeg) {
  const out = new Uint8Array(38 + jpeg.length),
    v = new DataView(out.buffer);
  out.set([73, 73, 42, 0]);
  v.setUint32(4, 8, true);
  v.setUint16(8, 2, true);
  for (const [i, tag, value] of [
    [0, 513, 38],
    [1, 514, jpeg.length],
  ]) {
    const p = 10 + i * 12;
    v.setUint16(p, tag, true);
    v.setUint16(p + 2, 4, true);
    v.setUint32(p + 4, 1, true);
    v.setUint32(p + 8, value, true);
  }
  out.set(jpeg, 38);
  return out;
}
export async function corruptPngIcc(input) {
  const png = await sharp(input).withIccProfile('srgb').png().toBuffer();
  let pos = 8;
  while (pos < png.length) {
    const length = png.readUInt32BE(pos);
    if (png.toString('ascii', pos + 4, pos + 8) === 'iCCP') {
      const payload = Buffer.concat([
        Buffer.from('ICC\0\0'),
        deflateSync(new Uint8Array(140)),
      ]);
      const chunk = Buffer.alloc(payload.length + 12);
      chunk.writeUInt32BE(payload.length);
      chunk.write('iCCP', 4);
      payload.copy(chunk, 8);
      let crc = 0xffffffff;
      for (const byte of chunk.subarray(4, -4)) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++)
          crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
      chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
      return Buffer.concat([
        png.subarray(0, pos),
        chunk,
        png.subarray(pos + length + 12),
      ]);
    }
    pos += length + 12;
  }
  throw new Error('Fixture has no iCCP');
}
