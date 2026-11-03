import { createEngine } from './core.js';

let engine,
  serial = Promise.resolve();
/** @param {import('./types').EngineRequest} request */
async function execute({
  id,
  method,
  file,
  recipe,
  baseUrl,
  converted,
  mobile,
  region,
}) {
  try {
    if (!engine) {
      const { default: Vips } = await import(
        /* @vite-ignore */ `${baseUrl}engine/wasm-vips-0.0.19/vips-es6.js`
      );
      const vips = await Vips({
        dynamicLibraries: ['vips-heif.wasm'],
        locateFile: (name) => `${baseUrl}engine/wasm-vips-0.0.19/${name}`,
      });
      const response = await fetch(`${baseUrl}profiles/AdobeCompat-v2.icc`);
      if (!response.ok)
        throw new Error('입력 ICC 프로파일을 불러오지 못했습니다.');
      vips.FS.writeFile(
        '/adobe.icc',
        new Uint8Array(await response.arrayBuffer()),
      );
      engine = createEngine(vips, { maxPixels: mobile ? 50000000 : 200000000 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const convertedBytes = converted
      ? new Uint8Array(await converted.arrayBuffer())
      : undefined;
    const result =
      method === 'inspect'
        ? await engine.inspect(bytes, file.name, convertedBytes)
        : await engine.run(bytes, file.name, recipe, {
            preview: method === 'preview' && !region,
            convertedBytes,
            region,
          });
    if (region) result.artifacts = [];
    self.postMessage({ id, result });
  } catch (error) {
    const message = String(error?.message || error);
    self.postMessage({
      id,
      error: message,
      fatal: /out of memory|memory access|aborted|allocation failed/i.test(
        message,
      ),
    });
  }
}
self.onmessage = ({ data }) => {
  serial = serial.then(
    () => execute(data),
    () => execute(data),
  );
};
