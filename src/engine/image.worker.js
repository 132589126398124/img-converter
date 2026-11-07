import { createEngine } from './core.js';

let engine, operations = 0,
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
    // WASM memory cannot shrink. Release the complete worker after a final job,
    // and periodically during inspection, instead of retaining its high-water heap.
    self.postMessage({ id, result, recycle: method === 'run' || ++operations >= 8 });
  } catch (error) {
    const message = String(error?.message || error);
    const fatal = /out of memory|insufficient memory|memory access|aborted|allocation failed|wbuffer_write|unable to encode/i.test(message);
    self.postMessage({
      id,
      error: fatal
        ? `이미지 엔진의 메모리 또는 인코더 오류로 작업을 멈췄습니다. 완료된 결과는 유지됩니다. 새 엔진으로 재시도할 수 있습니다. (${message})`
        : message,
      fatal,
    });
  }
}
self.onmessage = ({ data }) => {
  serial = serial.then(
    () => execute(data),
    () => execute(data),
  );
};
