import { getArtifact } from './storage.js';

export const ZIP_LIMIT = 64 * 1024 * 1024;
export function fileTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
export function uniqueNames(items, prefix = '') {
  const used = new Set();
  return items.map((item) => {
    const base =
      [...item.name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*]/g, '_')]
        .map((c) => (c.charCodeAt(0) < 32 ? '_' : c))
        .join('')
        .replace(/\.+$/, '') || 'photo';
    const stem = `${prefix}${base}${item.part ? `_part${String(item.part).padStart(2, '0')}` : ''}`;
    let name = `${stem}.${item.format}`,
      index = 2;
    while (used.has(name.toLowerCase()))
      name = `${stem}__${index++}.${item.format}`;
    used.add(name.toLowerCase());
    return { ...item, outputName: name };
  });
}
export function archiveGroups(items, limit = ZIP_LIMIT) {
  const groups = [];
  let current = [],
    size = 0;
  for (const item of items) {
    if (current.length && size + item.bytes > limit) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += item.bytes;
  }
  if (current.length) groups.push(current);
  return groups;
}
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function makeArchives(tasks, prefix = '', onProgress = () => {}) {
  const items = uniqueNames(
    tasks.flatMap((task) =>
      (task.result?.artifacts || []).map((a, i, all) => ({
        ...a,
        name: task.name,
        part: all.length > 1 ? i + 1 : null,
      })),
    ),
    prefix,
  );
  const groups = archiveGroups(items),
    archives = [];
  for (let g = 0; g < groups.length; g++) {
    const zipWorker = new Worker(new URL('./zip.worker.js', import.meta.url), {
      type: 'module',
    });
    try {
      const blobs = [];
      for (const item of groups[g])
        blobs.push({
          name: item.outputName,
          blob: await getArtifact(item.key),
        });
      const blob = await new Promise((resolve, reject) => {
        zipWorker.onmessage = ({ data }) => {
          if (data.progress !== undefined)
            onProgress(
              Math.round(((g + data.progress / 100) / groups.length) * 100),
            );
          else if (data.error) reject(new Error(data.error));
          else resolve(data.blob);
        };
        zipWorker.onerror = () =>
          reject(new Error('ZIP 생성에 실패했습니다. 개별 파일로 저장하세요.'));
        zipWorker.postMessage(blobs);
      });
      archives.push({
        blob,
        name: `lumina_${fileTimestamp().slice(0, 8)}_${String(g + 1).padStart(2, '0')}.zip`,
      });
    } finally {
      zipWorker.terminate();
    }
  }
  return archives;
}
