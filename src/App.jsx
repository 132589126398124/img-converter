import { useEffect, useRef, useState } from 'react';
import {
  Aperture,
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ImagePlus,
  LoaderCircle,
  Moon,
  Pause,
  Play,
  Settings2,
  Share2,
  ShieldCheck,
  Square,
  Sun,
  X,
} from 'lucide-react';
import { DEFAULT_RECIPE, normalizeRecipe } from './engine/recipe';
import { preview } from './engine/client';
import { useWorkspace } from './workspace/useWorkspace';
import { getArtifact } from './workspace/storage';
import {
  downloadBlob,
  makeArchives,
  uniqueNames,
  fileTimestamp,
} from './workspace/export';
import SettingsPanel, { PurposeButtons } from './components/SettingsPanel';
import PhotoViewer from './components/PhotoViewer';
import { useBlobUrl } from './components/useBlobUrl';
import './App.css';

const STATUS = {
  inspecting: '사진 확인 중',
  ready: '준비됨',
  working: '변환·검증 중',
  done: '검증 완료',
  unmet: '목표 미달',
  error: '처리 실패',
  missing: '원본 재선택 필요',
  cancelled: '취소됨',
};
const META = {
  verified: '촬영정보 확인됨',
  partial: '일부 보존',
  none: '촬영정보 없음',
  stripped: '촬영정보 제거됨',
};
const sizeLabel = (bytes) =>
  bytes < 1048576
    ? `${(bytes / 1024).toFixed(0)} KB`
    : `${(bytes / 1048576).toFixed(2)} MB`;
function readPreference(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function Thumb({ task }) {
  const url = useBlobUrl(task.asset?.thumbnail);
  return (
    <div className="thumb">
      {url ? (
        <img src={url} alt="" />
      ) : task.status === 'inspecting' ? (
        <LoaderCircle className="spin" size={20} />
      ) : (
        <Aperture size={24} />
      )}
    </div>
  );
}
function ArchiveLink({ archive }) {
  const url = useBlobUrl(archive.blob);
  return (
    <a
      className="button secondary"
      href={url || undefined}
      download={archive.name}
    >
      <ArrowDownToLine size={16} />
      {archive.name} · {sizeLabel(archive.blob.size)}
    </a>
  );
}

export default function App() {
  const workspace = useWorkspace();
  const { tasks, ready, running, checking, paused, notice, setNotice } =
    workspace;
  const [recipe, setRecipe] = useState(() => {
    try {
      return normalizeRecipe(readPreference('lumina.recipe', DEFAULT_RECIPE));
    } catch {
      return DEFAULT_RECIPE;
    }
  });
  const [theme, setTheme] = useState(() =>
    readPreference(
      'lumina.theme',
      window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light',
    ),
  );
  const [selectedId, setSelectedId] = useState(null),
    [step, setStep] = useState('files'),
    [settingsOpen, setSettingsOpen] = useState(false);
  const [dragging, setDragging] = useState(false),
    [draft, setDraft] = useState(null),
    [draftBusy, setDraftBusy] = useState(false),
    [draftError, setDraftError] = useState('');
  const [resultFiles, setResultFiles] = useState([]),
    [slice, setSlice] = useState(0),
    [requestedView, setView] = useState('draft');
  const [zipping, setZipping] = useState(false),
    [zipProgress, setZipProgress] = useState(0),
    [archives, setArchives] = useState([]),
    [timestamp, setTimestamp] = useState(false);
  const input = useRef(),
    dragCount = useRef(0);
  const selected = tasks.find((t) => t.id === selectedId) || tasks[0];
  const view = !selected?.file && selected?.result ? 'result' : requestedView;
  const selectedRecipe = normalizeRecipe({ ...recipe, ...selected?.crop });
  const recipeKey = JSON.stringify(selectedRecipe);
  const done = tasks.filter((t) => t.result);
  const eligible = tasks.filter(
    (t) =>
      t.file &&
      t.asset &&
      (!t.result ||
        JSON.stringify(t.result.recipe) !==
          JSON.stringify(normalizeRecipe({ ...recipe, ...t.crop }))),
  );
  const locked = running || checking;
  const patchRecipe = (patch) => {
    setRecipe((prev) => normalizeRecipe({ ...prev, ...patch }));
    setView('draft');
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('lumina.theme', JSON.stringify(theme));
    } catch {
      /* Optional preference. */
    }
  }, [theme]);
  useEffect(() => {
    try {
      localStorage.setItem('lumina.recipe', JSON.stringify(recipe));
    } catch {
      /* Optional preference. */
    }
  }, [recipe]);
  useEffect(() => {
    const prevent = (e) => e.preventDefault();
    const enter = (e) => {
      e.preventDefault();
      if (e.dataTransfer?.types.includes('Files')) {
        dragCount.current++;
        setDragging(true);
      }
    };
    const leave = (e) => {
      e.preventDefault();
      dragCount.current--;
      if (dragCount.current <= 0) setDragging(false);
    };
    const drop = (e) => {
      e.preventDefault();
      dragCount.current = 0;
      setDragging(false);
      if (!locked) workspace.addFiles(e.dataTransfer.files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', drop);
    };
  });
  useEffect(() => {
    const abort = new AbortController();
    let active = true;
    setDraft(null);
    setDraftError('');
    setDraftBusy(false);
    if (!selected?.file || !selected.asset || locked)
      return () => abort.abort();
    const timer = setTimeout(() => {
      setDraftBusy(true);
      preview(selected, JSON.parse(recipeKey), abort.signal)
        .then((result) => {
          if (active) setDraft(result);
        })
        .catch((error) => {
          if (active && error.name !== 'AbortError')
            setDraftError(error.message);
        })
        .finally(() => {
          if (active) setDraftBusy(false);
        });
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
      abort.abort();
    };
  }, [selected, recipeKey, locked]);
  useEffect(() => {
    let active = true;
    setResultFiles([]);
    setSlice(0);
    if (!selected?.result) return;
    const named = uniqueNames(
      selected.result.artifacts.map((a, i, all) => ({
        ...a,
        name: selected.name,
        part: all.length > 1 ? i + 1 : null,
      })),
    );
    Promise.all(
      named.map(
        async (item) =>
          new File([await getArtifact(item.key)], item.outputName, {
            type: `image/${item.format === 'jpg' ? 'jpeg' : item.format}`,
          }),
      ),
    )
      .then((files) => {
        if (active) setResultFiles(files);
      })
      .catch((e) => {
        if (active) setNotice(e.message);
      });
    return () => {
      active = false;
    };
  }, [selected?.id, selected?.result, selected?.name, setNotice]);
  const activeBlob =
    view === 'result' && resultFiles[slice]
      ? resultFiles[slice]
      : draft?.artifacts[slice]?.blob ||
        draft?.artifacts[0]?.blob ||
        selected?.asset?.thumbnail;
  const displayedCount =
    view === 'result' ? resultFiles.length : draft?.artifacts.length || 1;
  const selectedStale =
    selected?.result && JSON.stringify(selected.result.recipe) !== recipeKey;
  let canShare = false;
  try {
    canShare =
      resultFiles.length > 0 && !!navigator.canShare?.({ files: resultFiles });
  } catch {
    /* Downloads remain available. */
  }
  const process = async (ids) => {
    setView('result');
    setStep('results');
    setSettingsOpen(false);
    await workspace.start(recipe, ids);
  };
  const share = () =>
    navigator.share({ files: resultFiles }).catch((e) => {
      if (e.name !== 'AbortError')
        setNotice(`공유하지 못했습니다: ${e.message}`);
    });
  const exportZip = async () => {
    setZipping(true);
    setArchives([]);
    try {
      setArchives(
        await makeArchives(
          done,
          timestamp ? `${fileTimestamp()}_` : '',
          setZipProgress,
        ),
      );
    } catch (e) {
      setNotice(e.message);
    } finally {
      setZipping(false);
    }
  };

  return (
    <div className="app-shell">
      <input
        ref={input}
        id="file-input"
        type="file"
        multiple
        hidden
        accept="image/jpeg,image/png,image/webp,image/avif,image/tiff,image/heic,image/heif,.tif,.tiff,.heic,.heif,.cr3,.dng"
        onChange={(e) => {
          workspace.addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <header className="topbar">
        <a className="brand" href="#">
          <span className="brand-mark">
            <Aperture size={26} strokeWidth={1.4} />
          </span>
          <span>
            Lumina<span className="brand-light"> Flow</span>
            <small>LOCAL PHOTO STUDIO</small>
          </span>
        </a>
        <div className="header-right">
          <span className="local-pill">
            <span />
            사진은 이 기기에만
          </span>
          <button
            className="icon-button"
            aria-label="테마 변경"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
          </button>
        </div>
      </header>
      <div className="intro-row">
        <div>
          <span className="eyebrow">사진 추가부터 저장까지, 한곳에서</span>
          <h1>사진은 그대로, 쓰임은 새롭게.</h1>
          <p>색은 정확하게, 디테일은 섬세하게. 저장되는 결과까지 확인하세요.</p>
        </div>
        <div className="intro-note">
          <ShieldCheck size={23} />
          <span>
            고정밀 색상 처리
            <br />
            <strong>16-bit input · ICC managed</strong>
          </span>
        </div>
      </div>
      {!globalThis.crossOriginIsolated && (
        <div className="notice warning" role="alert">
          고정밀 엔진을 위한 격리 환경이 활성화되지 않았습니다. HTTPS와
          COOP/COEP 헤더가 필요합니다.
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          <CircleHelp size={18} />
          <span>{notice}</span>
          <button
            aria-label="알림 닫기"
            className="icon-button"
            onClick={() => setNotice('')}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <nav className="mobile-steps" aria-label="작업 단계">
        {[
          ['files', '01', '사진'],
          ['settings', '02', '설정·미리보기'],
          ['results', '03', '결과'],
        ].map(([key, n, label]) => (
          <button
            key={key}
            className={step === key ? 'active' : ''}
            onClick={() => setStep(key)}
          >
            <small>{n}</small>
            {label}
          </button>
        ))}
      </nav>
      <main className="studio" data-step={step}>
        <aside className="photo-rail">
          <div className="panel-title">
            <h2>
              사진 목록 <span>{tasks.length.toString().padStart(2, '0')}</span>
            </h2>
            <button
              className="icon-button"
              aria-label="사진 추가"
              disabled={!ready || locked}
              onClick={() => input.current.click()}
            >
              <ImagePlus size={19} />
            </button>
          </div>
          <button
            className="add-zone"
            disabled={!ready || locked}
            onClick={() => input.current.click()}
          >
            <ImagePlus size={23} />
            <strong>
              {checking ? '사진을 확인하고 있어요' : '사진 추가하기'}
            </strong>
            <span>끌어놓기 또는 파일 선택</span>
            <small>JPG · TIFF · HEIC · CR3 · DNG</small>
          </button>
          {!tasks.length ? (
            <div className="rail-empty">
              <span>01 / IMPORT</span>
              <p>
                한 장부터 한 묶음까지.
                <br />
                원본은 그대로 보관됩니다.
              </p>
            </div>
          ) : (
            <div className="photo-list" aria-label="추가한 사진">
              {tasks.map((task, i) => (
                <div
                  key={task.id}
                  className={`photo-item ${task.id === selected?.id ? 'selected' : ''}`}
                >
                  <button
                    className="photo-select"
                    onClick={() => {
                      setSelectedId(task.id);
                      setSlice(0);
                      setView(task.result ? 'result' : 'draft');
                      if (step === 'files') setStep('settings');
                    }}
                    aria-label={`${task.name} 선택`}
                  >
                    <Thumb task={task} />
                    <span className="photo-label">
                      <strong>{task.name}</strong>
                      <span>
                        {task.asset
                          ? `${task.asset.width} × ${task.asset.height} · ${task.asset.bits}-bit`
                          : sizeLabel(task.size)}
                      </span>
                      <small className={`status status-${task.status}`}>
                        {task.status === 'working' ||
                        task.status === 'inspecting' ? (
                          <LoaderCircle size={11} className="spin" />
                        ) : task.result ? (
                          <Check size={11} />
                        ) : (
                          <span className="status-dot" />
                        )}
                        {STATUS[task.status]}
                      </small>
                    </span>
                    <span className="item-number">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                  </button>
                  <button
                    className="remove-item icon-button"
                    aria-label={`${task.name} 목록에서 제거`}
                    disabled={locked}
                    onClick={() => workspace.remove(task.id)}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="rail-footer">
            <span>{done.length}장 결과 보관 중</span>
            {done.length > 0 && (
              <button
                className="text-button"
                disabled={zipping}
                onClick={exportZip}
              >
                {zipping ? `${zipProgress}%` : 'ZIP 만들기'}
                <ArrowDownToLine size={14} />
              </button>
            )}
          </div>
        </aside>
        <section className="stage">
          <div className="stage-toolbar">
            <div>
              <span className="eyebrow">
                {view === 'result' && selected?.result
                  ? 'VERIFIED OUTPUT'
                  : 'LIVE PREVIEW'}
              </span>
              <h2>{selected ? selected.name : '사진을 위한 작업 공간'}</h2>
            </div>
            <button
              className="mobile-settings button secondary"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 size={15} />
              설정
            </button>
          </div>
          <div className="mobile-purpose">
            <PurposeButtons
              purpose={recipe.purpose}
              disabled={locked}
              onChange={(purpose) => patchRecipe({ purpose })}
            />
          </div>
          {selected ? (
            <>
              <div className="viewer-tabs">
                <button
                  disabled={!selected.file}
                  className={view === 'draft' ? 'active' : ''}
                  onClick={() => {
                    setView('draft');
                    setSlice(0);
                  }}
                >
                  작업 미리보기
                </button>
                <button
                  disabled={!selected.result}
                  className={view === 'result' ? 'active' : ''}
                  onClick={() => {
                    setView('result');
                    setSlice(0);
                  }}
                >
                  저장 파일 {selectedStale && <span className="tiny-dot" />}
                </button>
                <span>
                  {view === 'draft'
                    ? '축소 미리보기'
                    : selectedStale
                      ? '이전 설정 결과'
                      : '실제 인코딩 결과'}
                </span>
              </div>
              <PhotoViewer
                key={selected.id}
                blob={activeBlob}
                panoramaBlobs={
                  view === 'result'
                    ? resultFiles
                    : draft?.artifacts.map((a) => a.blob)
                }
                sliceIndex={slice}
                onSlice={setSlice}
                task={selected}
                recipe={
                  view === 'result' && selected.result
                    ? selected.result.recipe
                    : selectedRecipe
                }
                pending={draftBusy || selected.status === 'working'}
                canProof={!!selected.file && !!selected.asset && !locked}
                onError={setNotice}
              />
              {displayedCount > 1 && (
                <div className="slice-nav">
                  <button
                    className="icon-button"
                    aria-label="이전 컷"
                    onClick={() =>
                      setSlice((i) => (i - 1 + displayedCount) % displayedCount)
                    }
                  >
                    <ChevronLeft size={16} />
                  </button>
                  {Array.from({ length: displayedCount }, (_, i) => (
                    <button
                      key={i}
                      className={slice === i ? 'active' : ''}
                      onClick={() => setSlice(i)}
                    >
                      {String(i + 1).padStart(2, '0')}
                    </button>
                  ))}
                  <button
                    className="icon-button"
                    aria-label="다음 컷"
                    onClick={() => setSlice((i) => (i + 1) % displayedCount)}
                  >
                    <ChevronRight size={16} />
                  </button>
                  <span>왼쪽부터 이어지는 분할 순서</span>
                </div>
              )}
              {selected.error && (
                <div className="inline-error" role="alert">
                  {selected.error}
                </div>
              )}
              {selected.file &&
                !selected.asset &&
                selected.status === 'error' && (
                  <button
                    className="button secondary"
                    disabled={locked}
                    onClick={() => workspace.addFiles([selected.file])}
                  >
                    사진 다시 검사
                  </button>
                )}
              {draftError && (
                <div className="inline-error" role="alert">
                  {draftError}
                </div>
              )}
              <div className="source-strip">
                <span>
                  {selected.asset?.format?.toUpperCase() || '—'}
                  <small>입력 포맷</small>
                </span>
                <span>
                  {selected.asset?.bits || '—'}-bit<small>입력 정밀도</small>
                </span>
                <span>
                  {selected.asset?.icc || '확인 중'}
                  <small>입력 ICC</small>
                </span>
              </div>
              {selected.asset?.provenance === 'embedded-jpeg' && (
                <div className="source-label">
                  RAW 내장 JPEG 기반 · 표시 해상도는 추출 이미지 기준입니다.
                </div>
              )}
              {[
                ...new Set([
                  ...(selected.asset?.warnings || []),
                  ...(view === 'result'
                    ? selected.result?.warnings || []
                    : draft?.warnings || []),
                ]),
              ].map((w) => (
                <p className="subtle-warning" key={w}>
                  {w}
                </p>
              ))}
              {recipe.purpose === 'social' && selected.file && (
                <div className="crop-controls">
                  <label>
                    이 사진의 가로 위치
                    <input
                      aria-label="크롭 가로 위치"
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={selected.crop.cropX}
                      disabled={locked}
                      onChange={(e) => {
                        workspace.setCrop(selected.id, {
                          cropX: +e.target.value,
                        });
                        setView('draft');
                      }}
                    />
                  </label>
                  <label>
                    세로 위치
                    <input
                      aria-label="크롭 세로 위치"
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={selected.crop.cropY}
                      disabled={locked}
                      onChange={(e) => {
                        workspace.setCrop(selected.id, {
                          cropY: +e.target.value,
                        });
                        setView('draft');
                      }}
                    />
                  </label>
                </div>
              )}
              {selected.result && (
                <div className="output-report">
                  <div className="report-heading">
                    <ShieldCheck size={19} />
                    <h3>저장 파일 검사</h3>
                    <span>
                      {selected.result.artifacts.every(
                        (a) => a.checks.withinTarget,
                      )
                        ? '확인 완료'
                        : '목표 용량 미달'}
                    </span>
                  </div>
                  {selected.result.artifacts.map((a, i) => (
                    <div className="artifact-row" key={a.key}>
                      <div>
                        <strong>
                          {a.format.toUpperCase()}{' '}
                          {selected.result.artifacts.length > 1
                            ? `· ${i + 1}번 컷`
                            : ''}
                          <span>{sizeLabel(a.bytes)}</span>
                        </strong>
                        <p>
                          {a.width} × {a.height} · {a.checks.icc} ·{' '}
                          {a.quality === null
                            ? a.checks.losslessCopy
                              ? '픽셀 재압축 없음'
                              : '무손실 포맷'
                            : `품질 ${a.quality}`}
                        </p>
                        <small>
                          <Check size={12} />
                          포맷·디코딩 확인 · {META[a.checks.metadata]}
                        </small>
                      </div>
                      <button
                        className="icon-button"
                        disabled={!resultFiles[i]}
                        aria-label={`${i + 1}번 결과 저장`}
                        onClick={() =>
                          downloadBlob(resultFiles[i], resultFiles[i].name)
                        }
                      >
                        <ArrowDownToLine size={19} />
                      </button>
                    </div>
                  ))}
                  <p className="engine-caption">
                    {(selected.result.elapsedMs / 1000).toFixed(1)}초 · 원본
                    수정 없음
                  </p>
                  <div className="result-actions">
                    {canShare && (
                      <button className="button secondary" onClick={share}>
                        <Share2 size={16} />
                        파일 공유
                      </button>
                    )}
                    <button
                      className="button secondary"
                      disabled={locked || !selected.file}
                      onClick={() => process([selected.id])}
                    >
                      이 사진 다시 처리
                    </button>
                  </div>
                </div>
              )}
              {!selected.file && (
                <button
                  className="button secondary reselect"
                  disabled={locked}
                  onClick={() => input.current.click()}
                >
                  <ImagePlus size={16} />
                  원본을 다시 선택해 작업 이어가기
                </button>
              )}
              {selected.file && selected.asset && !selected.result && (
                <button
                  className="single-proof button secondary"
                  disabled={locked}
                  onClick={() => process([selected.id])}
                >
                  이 사진 먼저 변환·검증 <ArrowRight size={16} />
                </button>
              )}
            </>
          ) : (
            <div className="empty-stage">
              <div className="empty-art">
                <div className="frame-line frame-one" />
                <div className="frame-line frame-two" />
                <Aperture size={50} strokeWidth={1} />
              </div>
              <span className="eyebrow">첫 번째 단계 · 사진 추가</span>
              <h2>어떤 사진을 바꿔볼까요?</h2>
              <p>
                사진을 추가하면 출력 크기와 구도를 미리 보고,
                <br />
                원하는 결과를 만들어 저장할 수 있습니다.
              </p>
              <button
                className="button primary"
                disabled={!ready}
                onClick={() => input.current.click()}
              >
                <ImagePlus size={17} />첫 사진 추가하기
              </button>
              <span className="empty-footnote">
                로컬 처리 · 촬영정보 선택 · 결과 재검증
              </span>
            </div>
          )}
        </section>
        {settingsOpen && (
          <button
            className="sheet-backdrop"
            aria-label="설정 닫기"
            onClick={() => setSettingsOpen(false)}
          />
        )}
        <SettingsPanel
          recipe={recipe}
          onChange={patchRecipe}
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          locked={locked}
        />
      </main>
      {archives.length > 0 && (
        <section className="archive-tray">
          <div>
            <h3>ZIP 파일이 준비되었습니다</h3>
            <p>파일 합계 64MiB 단위로 나눴습니다. 각 파일을 눌러 저장하세요.</p>
          </div>
          <div>
            {archives.map((a) => (
              <ArchiveLink key={a.name} archive={a} />
            ))}
          </div>
          <button
            aria-label="ZIP 목록 닫기"
            className="icon-button"
            onClick={() => setArchives([])}
          >
            <X size={18} />
          </button>
        </section>
      )}
      <div className="batch-bar">
        <div className="batch-status">
          <span
            className={running || checking ? 'activity active' : 'activity'}
          />
          <div>
            <strong>
              {running
                ? paused
                  ? '현재 사진 완료 후 멈춥니다'
                  : '사진을 변환하고 검증하고 있어요'
                : checking
                  ? '사진 정보를 확인하고 있어요'
                  : paused
                    ? '작업이 멈춰 있습니다'
                    : eligible.length
                      ? `${eligible.length}장 처리 준비`
                      : done.length
                        ? '결과를 저장할 수 있어요'
                        : '사진을 추가해 주세요'}
            </strong>
            <small>
              {done.length}장 결과 보관 · {tasks.length}장 중{' '}
              {tasks.filter((t) => t.status === 'error').length}장 실패
            </small>
          </div>
        </div>
        <div className="batch-buttons">
          {running ? (
            <>
              <button
                className="button secondary"
                onClick={workspace.pause}
                disabled={paused}
              >
                <Pause size={17} />
                일시정지
              </button>
              <button className="button secondary" onClick={workspace.cancel}>
                <Square size={15} />
                취소
              </button>
            </>
          ) : (
            <>
              <label className="timestamp-option">
                <input
                  type="checkbox"
                  checked={timestamp}
                  onChange={(e) => setTimestamp(e.target.checked)}
                />
                ZIP 안 파일명에 날짜
              </label>
              {done.length > 0 && (
                <button
                  className={`button ${eligible.length ? 'secondary' : 'primary'} zip-button`}
                  onClick={exportZip}
                  disabled={zipping}
                >
                  {zipping ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <ArrowDownToLine size={16} />
                  )}
                  {zipping ? `${zipProgress}%` : '전체 ZIP'}
                </button>
              )}
              {(eligible.length > 0 || !done.length) && (
                <button
                  className="button primary"
                  disabled={!eligible.length || !ready || checking}
                  onClick={() => process()}
                >
                  <Play size={16} fill="currentColor" />
                  {paused
                    ? '이어서 처리'
                    : eligible.length
                      ? `${eligible.length}장 변환하기`
                      : '사진을 추가해 주세요'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <footer className="site-footer">
        <span>LUMINA FLOW / 모든 사진은 당신의 기기 안에서.</span>
        <span>색상 관리 · 촬영정보 선택 · 파일 검증</span>
      </footer>
      {dragging && (
        <div className="drop-overlay">
          <ImagePlus size={45} />
          <h2>여기에 사진을 놓으세요</h2>
          <p>원본을 수정하거나 서버로 전송하지 않습니다.</p>
        </div>
      )}
    </div>
  );
}
