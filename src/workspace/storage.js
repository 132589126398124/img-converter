let database;
const volatile = new Map();
const request = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
async function db() {
  if (!database)
    database = new Promise((resolve, reject) => {
      const open = indexedDB.open('lumina-flow', 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore('tasks', { keyPath: 'id' });
        open.result.createObjectStore('artifacts');
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
      open.onblocked = () =>
        reject(new Error('다른 탭에서 저장소를 사용 중입니다.'));
    });
  return database;
}
const settled = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = (event) => reject(event.target.error || tx.error);
    tx.onabort = () => reject(tx.error || new Error('저장 중단'));
  });
// Prepare binary records before opening transactions, which can auto-commit
// across await boundaries. Some WebKit ports cannot store Blob objects.
async function packBlob(blob) {
  return { bytes: await blob.arrayBuffer(), type: blob.type };
}
function unpackBlob(value) {
  return value?.bytes instanceof ArrayBuffer
    ? new Blob([value.bytes], { type: value.type })
    : value;
}
async function manifest(task) {
  const { file: _file, ...saved } = task;
  if (saved.asset?.thumbnail instanceof Blob)
    saved.asset = {
      ...saved.asset,
      thumbnail: await packBlob(saved.asset.thumbnail),
    };
  return saved;
}
export async function listTasks() {
  const data = await db();
  const tasks = await request(
    data.transaction('tasks').objectStore('tasks').getAll(),
  );
  return tasks.map((task) =>
    task.asset
      ? {
          ...task,
          asset: { ...task.asset, thumbnail: unpackBlob(task.asset.thumbnail) },
        }
      : task,
  );
}
export async function saveTask(task) {
  const record = await manifest(task);
  const data = await db(),
    tx = data.transaction('tasks', 'readwrite'),
    done = settled(tx);
  tx.objectStore('tasks').put(record);
  await done;
}
export async function saveResult(task, result) {
  const artifacts = result.artifacts.map(({ blob: _blob, ...item }, i) => ({
    ...item,
    key: `${task.id}:${i}`,
  }));
  const saved = {
    ...task,
    status: result.artifacts.some((a) => !a.checks.withinTarget)
      ? 'unmet'
      : 'done',
    result: { ...result, artifacts },
    error: null,
  };
  try {
    const record = await manifest(saved);
    const payloads = [];
    for (const artifact of result.artifacts)
      payloads.push(await packBlob(artifact.blob));
    const data = await db(),
      tx = data.transaction(['tasks', 'artifacts'], 'readwrite'),
      done = settled(tx);
    try {
      for (const old of task.result?.artifacts || [])
        tx.objectStore('artifacts').delete(old.key);
      tx.objectStore('tasks').put(record);
      for (let i = 0; i < result.artifacts.length; i++)
        tx.objectStore('artifacts').put(payloads[i], artifacts[i].key);
    } catch (error) {
      tx.abort();
      await done.catch(() => {});
      throw error;
    }
    await done;
    for (const old of task.result?.artifacts || []) volatile.delete(old.key);
    for (const item of artifacts) volatile.delete(item.key);
    return { task: saved, durable: true };
  } catch (error) {
    for (let i = 0; i < result.artifacts.length; i++)
      volatile.set(artifacts[i].key, result.artifacts[i].blob);
    return {
      task: saved,
      durable: false,
      storageError: error?.name || 'UnknownError',
    };
  }
}
export async function getArtifact(key) {
  if (volatile.has(key)) return volatile.get(key);
  const data = await db();
  const blob = await request(
    data.transaction('artifacts').objectStore('artifacts').get(key),
  );
  if (!blob)
    throw new Error(
      '결과 파일이 저장소에 없습니다. 원본을 다시 선택해 재처리하세요.',
    );
  return unpackBlob(blob);
}
export async function deleteTask(task) {
  for (const item of task.result?.artifacts || []) volatile.delete(item.key);
  const data = await db(),
    tx = data.transaction(['tasks', 'artifacts'], 'readwrite'),
    done = settled(tx);
  tx.objectStore('tasks').delete(task.id);
  for (const item of task.result?.artifacts || [])
    tx.objectStore('artifacts').delete(item.key);
  await done;
}
