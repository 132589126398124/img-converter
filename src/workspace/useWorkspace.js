import { useCallback, useEffect, useRef, useState } from 'react';
import * as engine from '../engine/client';
import { normalizeRecipe } from '../engine/recipe.js';
import {
  listTasks,
  saveTask,
  saveResult,
  deleteTask,
  deleteTasks,
} from './storage.js';

export function useWorkspace() {
  const [tasks, setTasks] = useState([]),
    [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false),
    [paused, setPaused] = useState(false),
    [notice, setNotice] = useState('');
  const [clearing, setClearing] = useState(false);
  const current = useRef([]),
    pausedRef = useRef(false),
    controller = useRef(),
    busy = useRef(false),
    importing = useRef(false);
  const update = useCallback((fn) => {
    current.current = fn(current.current);
    setTasks(current.current);
  }, []);
  useEffect(() => {
    let active = true;
    listTasks()
      .then((saved) => {
        if (active)
          update(() =>
            saved
              .sort((a, b) => a.created - b.created)
              .map((t) => ({
                ...t,
                file: null,
                status: t.result ? t.status : 'missing',
              })),
          );
      })
      .catch(() => {
        if (active)
          setNotice(
            '브라우저 저장소를 사용할 수 없습니다. 결과는 탭을 닫기 전에 저장하세요.',
          );
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
      controller.current?.abort();
    };
  }, [update]);
  const persist = async (task) => {
    try {
      await saveTask(task);
    } catch {
      setNotice(
        '작업 정보를 저장하지 못했습니다. 탭을 닫기 전에 결과를 저장하세요.',
      );
    }
  };

  const addFiles = async (files) => {
    if (!ready || importing.current || busy.current) return;
    importing.current = true;
    try {
      for (const file of Array.from(files)) {
        const fingerprint = `${file.name}:${file.size}:${file.lastModified}`;
        const existing = current.current.find(
          (t) => t.fingerprint === fingerprint,
        );
        if (existing?.asset) {
          if (!existing.file)
            update((prev) =>
              prev.map((t) =>
                t.id === existing.id
                  ? { ...t, file, status: t.result ? t.status : 'ready' }
                  : t,
              ),
            );
          continue;
        }
        const task = existing
          ? { ...existing, file, status: 'inspecting', error: null }
          : {
              id: crypto.randomUUID(),
              fingerprint,
              file,
              name: file.name,
              size: file.size,
              created: Date.now(),
              status: 'inspecting',
              asset: null,
              result: null,
              crop: { cropX: 0.5, cropY: 0.5 },
            };
        update((prev) =>
          existing
            ? prev.map((t) => (t.id === task.id ? task : t))
            : [...prev, task],
        );
        try {
          const asset = await engine.inspect(file);
          const complete = {
            ...task,
            asset: { ...asset, id: task.id },
            status: 'ready',
          };
          update((prev) => prev.map((t) => (t.id === task.id ? complete : t)));
          await persist(complete);
        } catch (error) {
          const failed = { ...task, status: 'error', error: error.message };
          update((prev) => prev.map((t) => (t.id === task.id ? failed : t)));
          await persist(failed);
        }
      }
    } finally {
      importing.current = false;
    }
  };
  const start = async (value, ids) => {
    if (busy.current || importing.current) return;
    const recipe = normalizeRecipe(value);
    const targets = current.current.filter(
      (t) =>
        t.file &&
        t.asset &&
        t.status !== 'inspecting' &&
        (!ids || ids.includes(t.id)) &&
        (ids ||
          !t.result ||
          JSON.stringify(t.result.recipe) !==
            JSON.stringify({ ...recipe, ...t.crop })),
    );
    if (!targets.length) {
      setNotice(
        '처리할 사진이 없습니다. 원본을 재선택하거나 설정을 변경하세요.',
      );
      return;
    }
    busy.current = true;
    pausedRef.current = false;
    setRunning(true);
    setPaused(false);
    setNotice('');
    try {
      for (const item of targets) {
        if (pausedRef.current) break;
        controller.current = new AbortController();
        update((prev) =>
          prev.map((t) =>
            t.id === item.id ? { ...t, status: 'working', error: null } : t,
          ),
        );
        try {
          const result = await engine.run(
            item,
            normalizeRecipe({ ...recipe, ...item.crop }),
            controller.current.signal,
          );
          const saved = await saveResult(item, result);
          update((prev) =>
            prev.map((t) => (t.id === item.id ? saved.task : t)),
          );
          if (!saved.durable) {
            setNotice(
              saved.storageError === 'QuotaExceededError'
                ? '저장 공간이 부족해 다음 작업을 멈췄습니다. 현재 결과는 이 탭에서 저장할 수 있습니다.'
                : '브라우저에 결과를 보관하지 못해 다음 작업을 멈췄습니다. 탭을 닫기 전에 현재 결과를 저장하세요.',
            );
            pausedRef.current = true;
          }
        } catch (error) {
          const failed = {
            ...item,
            status: item.result
              ? item.status
              : error.name === 'AbortError'
                ? 'cancelled'
                : 'error',
            error: error.message,
          };
          update((prev) => prev.map((t) => (t.id === item.id ? failed : t)));
          await persist(failed);
          if (error.name === 'AbortError') break;
        }
      }
    } finally {
      busy.current = false;
      controller.current = null;
      setRunning(false);
      setPaused(pausedRef.current);
    }
  };
  const pause = () => {
    pausedRef.current = true;
    setPaused(true);
  };
  const cancel = () => {
    pausedRef.current = true;
    setPaused(true);
    controller.current?.abort();
  };
  const remove = async (id) => {
    if (busy.current || importing.current) return;
    const task = current.current.find((t) => t.id === id);
    if (!task) return;
    try {
      await deleteTask(task);
      update((prev) => prev.filter((t) => t.id !== id));
    } catch {
      setNotice('저장된 항목을 삭제하지 못했습니다. 다시 시도하세요.');
    }
  };
  const setCrop = (id, crop) =>
    update((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, crop: { ...t.crop, ...crop } } : t,
      ),
    );
  const clear = async () => {
    if (busy.current || importing.current || !ready) return false;
    busy.current = true;
    setClearing(true);
    try {
      await deleteTasks(current.current);
      update(() => []);
      pausedRef.current = false;
      setPaused(false);
      setNotice(
        '목록을 비웠습니다. 원본과 이미 다운로드한 파일은 그대로입니다.',
      );
      return true;
    } catch {
      setNotice('목록을 비우지 못했습니다. 다시 시도하세요.');
      return false;
    } finally {
      busy.current = false;
      setClearing(false);
    }
  };
  return {
    tasks,
    ready,
    running,
    paused,
    notice,
    setNotice,
    addFiles,
    start,
    pause,
    cancel,
    remove,
    clear,
    clearing,
    setCrop,
    checking: tasks.some((t) => t.status === 'inspecting'),
  };
}
