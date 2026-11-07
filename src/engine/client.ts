import { sniff } from './containers.js';
import type {
  Asset,
  ConversionResult,
  Recipe,
  PreviewResult,
  Region,
  EngineRequest,
} from './types';

let worker: Worker | null,
  nextId = 0,
  tail: Promise<unknown> = Promise.resolve();
const pending = new Map<
  number,
  { resolve: (result: unknown) => void; reject: (error: Error) => void }
>();
const mobile = () => window.matchMedia('(pointer: coarse)').matches;
function stop(
  error: Error = new DOMException('작업을 취소했습니다.', 'AbortError'),
) {
  worker?.terminate();
  worker = null;
  for (const slot of pending.values()) slot.reject(error);
  pending.clear();
}
function getWorker() {
  if (
    !globalThis.crossOriginIsolated ||
    typeof SharedArrayBuffer === 'undefined'
  )
    throw new Error(
      '고정밀 엔진을 사용할 수 없습니다. HTTPS와 교차 출처 격리 헤더를 확인하세요.',
    );
  if (!worker) {
    worker = new Worker(new URL('./image.worker.js', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = ({ data }) => {
      const slot = pending.get(data.id);
      if (!slot) return;
      pending.delete(data.id);
      if (data.error) {
        const error = new Error(data.error);
        if (data.fatal) error.name = 'EngineResourceError';
        if (data.fatal) stop(error);
        slot.reject(error);
      } else {
        if (data.recycle) stop();
        slot.resolve(data.result);
      }
    };
    worker.onerror = () => {
      const error = new Error(
          '이미지 엔진이 종료되었습니다. 메모리가 부족할 수 있습니다. 더 작은 파일로 재시도하세요.',
      );
      error.name = 'EngineResourceError';
      stop(error);
    };
  }
  return worker;
}

function call<Result>(
  method: 'inspect' | 'preview' | 'run',
  file: File,
  recipe?: Recipe,
  signal?: AbortSignal,
  region?: Region,
): Promise<Result> {
  const operation = async () => {
    if (signal?.aborted)
      throw new DOMException('작업을 취소했습니다.', 'AbortError');
    if (file.size > (mobile() ? 160 : 512) * 1024 * 1024)
      throw new Error(
        '이 기기의 파일 크기 안전 한도를 초과합니다. 더 작은 보정본을 사용하세요.',
      );
    let converted: Blob | undefined;
    const format = sniff(new Uint8Array(await file.slice(0, 64).arrayBuffer()));
    if (format === 'heic') {
      const { default: heic2any } = await import('heic2any');
      const output = await heic2any({ blob: file, toType: 'image/png' });
      if (Array.isArray(output) && output.length !== 1)
        throw new Error('다중 이미지 HEIC는 지원하지 않습니다.');
      converted = Array.isArray(output) ? output[0] : output;
    }
    if (signal?.aborted)
      throw new DOMException('작업을 취소했습니다.', 'AbortError');
    const w = getWorker(),
      id = ++nextId;
    const abort = () => stop();
    signal?.addEventListener('abort', abort, { once: true });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<Result>((resolve, reject) => {
        timeout = setTimeout(
          () =>
            stop(
              new Error(
                '처리 시간 한도를 초과했습니다. 작은 해상도 또는 다른 포맷을 선택하세요.',
              ),
            ),
          300000,
        );
        pending.set(id, {
          resolve: (value) => resolve(value as Result),
          reject,
        });
        const common = {
          id,
          file,
          converted,
          mobile: mobile(),
          baseUrl: new URL(import.meta.env.BASE_URL, document.baseURI).href,
        };
        const request: EngineRequest =
          method === 'inspect'
            ? { ...common, method }
            : { ...common, method, recipe: recipe!, region };
        w.postMessage(request);
      });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  };
  const result = tail.then(operation, operation);
  tail = result.catch(() => {});
  return result;
}

export const inspect = (file: File, signal?: AbortSignal) =>
  call<Omit<Asset, 'id'>>('inspect', file, undefined, signal);
export const preview = (
  asset: { file: File },
  recipe: Recipe,
  signal?: AbortSignal,
  region?: Region,
) => call<PreviewResult>('preview', asset.file, recipe, signal, region);
export const run = (
  asset: { file: File },
  recipe: Recipe,
  signal?: AbortSignal,
) => call<ConversionResult>('run', asset.file, recipe, signal);
