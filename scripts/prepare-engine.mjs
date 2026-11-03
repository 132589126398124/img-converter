import { mkdir, copyFile, readFile } from 'node:fs/promises';
const version = JSON.parse(
  await readFile('node_modules/wasm-vips/package.json', 'utf8'),
).version;
const dest = `public/engine/wasm-vips-${version}`;
await mkdir(dest, { recursive: true });
for (const file of ['vips-es6.js', 'vips.wasm', 'vips-heif.wasm']) {
  await copyFile(`node_modules/wasm-vips/lib/${file}`, `${dest}/${file}`);
}
await copyFile(
  'node_modules/wasm-vips/THIRD-PARTY-NOTICES.md',
  `${dest}/THIRD-PARTY-NOTICES.md`,
);
