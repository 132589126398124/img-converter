import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const fixtures = JSON.parse(
  await readFile('tests/camera-fixtures.json', 'utf8'),
);
await mkdir('tests/fixtures/external', { recursive: true });
for (const item of fixtures) {
  const path = `tests/fixtures/external/${item.name}`;
  let bytes;
  try {
    bytes = await readFile(path);
  } catch {
    /* Download missing public fixtures. */
  }
  const hash = (data) => createHash('sha256').update(data).digest('hex');
  if (bytes && hash(bytes) === item.sha256) {
    console.log(`${item.name}: cached, SHA256 verified`);
    continue;
  }
  const response = await fetch(item.url, {
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok)
    throw new Error(`Fixture download failed: ${response.status}`);
  bytes = new Uint8Array(await response.arrayBuffer());
  if (hash(bytes) !== item.sha256)
    throw new Error(`Fixture checksum mismatch: ${item.name}`);
  await writeFile(path, bytes);
  console.log(
    `${item.name}: ${(bytes.length / 1048576).toFixed(2)} MiB, CC0, SHA256 verified`,
  );
}
