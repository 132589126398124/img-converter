import { useEffect, useRef, useState } from 'react';
import { Expand, LoaderCircle, X, ZoomIn } from 'lucide-react';
import { preview } from '../engine/client';
import { useBlobUrl } from './useBlobUrl';
import { useDialog } from './useDialog';

function PanoramaTile({ blob, index, selected, onSelect }) {
  const url = useBlobUrl(blob);
  return (
    <button
      className={selected ? 'active' : ''}
      onClick={() => onSelect(index)}
      aria-label={`파노라마 ${index + 1}번 컷 선택`}
    >
      <img src={url || undefined} alt={`${index + 1}번 컷`} />
      <span>{index + 1}</span>
    </button>
  );
}
export default function PhotoViewer({
  blob,
  panoramaBlobs,
  sliceIndex,
  onSlice,
  task,
  recipe,
  pending,
  canProof,
  onError,
}) {
  const url = useBlobUrl(blob),
    [full, setFull] = useState(false),
    [proof, setProof] = useState(null),
    [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState({ x: 0.5, y: 0.5 });
  const abort = useRef();
  const before = useBlobUrl(proof?.before),
    after = useBlobUrl(proof?.after);
  const scrolls = useRef([]),
    syncing = useRef(false);
  const dialog = useRef();
  const close = () => {
    setFull(false);
    abort.current?.abort();
  };
  useDialog(full, dialog, close);
  useEffect(() => () => abort.current?.abort(), [task.id]);
  const inspectRegion = async () => {
    abort.current?.abort();
    abort.current = new AbortController();
    setBusy(true);
    setProof(null);
    setFull(true);
    try {
      const result = await preview(task, recipe, abort.current.signal, {
        ...focus,
        slice: sliceIndex,
      });
      setProof(result.proof);
    } catch (e) {
      if (e.name !== 'AbortError') onError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const synchronize = (e) => {
    if (syncing.current) return;
    syncing.current = true;
    for (const pane of scrolls.current)
      if (pane && pane !== e.currentTarget) {
        pane.scrollLeft = e.currentTarget.scrollLeft;
        pane.scrollTop = e.currentTarget.scrollTop;
      }
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  };
  return (
    <>
      <div
        className="photo-canvas"
        onPointerDown={(e) => {
          const rect = (
            e.currentTarget.querySelector('img') || e.currentTarget
          ).getBoundingClientRect();
          setFocus({
            x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
            y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
          });
        }}
      >
        {url ? (
          <img src={url} alt={`${task.name} 작업 미리보기`} />
        ) : (
          <div className="preview-missing">
            <LoaderCircle className="spin" size={25} />
            <span>이미지 정보를 준비합니다</span>
          </div>
        )}
        {pending && (
          <div className="preview-loading">
            <LoaderCircle className="spin" size={14} />
            <span>처리 중</span>
          </div>
        )}
        {url && (
          <span className="preview-coordinate">
            검사 위치 {Math.round(focus.x * 100)}% / {Math.round(focus.y * 100)}
            %
          </span>
        )}
      </div>
      <div className="viewer-tools">
        <span>사진을 눌러 정밀 검사 위치 선택</span>
        <button
          className="text-button"
          disabled={!canProof || busy || pending}
          onClick={inspectRegion}
        >
          <ZoomIn size={15} />
          100% 인코딩 검사
          <Expand size={13} />
        </button>
      </div>
      {panoramaBlobs?.length > 1 && (
        <div className="panorama-strip" aria-label="파노라마 연결 미리보기">
          {panoramaBlobs.map((part, index) => (
            <PanoramaTile
              key={index}
              blob={part}
              index={index}
              selected={index === sliceIndex}
              onSelect={onSlice}
            />
          ))}
        </div>
      )}
      {full && (
        <div className="compare-backdrop" onClick={close}>
          <section
            ref={dialog}
            className="compare-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="100% 인코딩 비교"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <span className="eyebrow">PIXEL INSPECTION</span>
                <h2>저장되는 디테일을 확인하세요.</h2>
                <p>
                  같은 출력 위치의 인코딩 전 픽셀과 최종 파일 · 1 이미지 픽셀 =
                  1 CSS 픽셀
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="비교 닫기"
                onClick={close}
              >
                <X size={21} />
              </button>
            </header>
            {busy ? (
              <div className="proof-loading">
                <LoaderCircle className="spin" size={28} />
                <p>최종 해상도로 인코딩하고 선택 영역을 확인합니다.</p>
              </div>
            ) : proof ? (
              <>
                <div className="proof-panes">
                  {[
                    [before, '인코딩 전 · 변형 적용 원본'],
                    [after, '최종 저장 파일'],
                  ].map(([src, label], i) => (
                    <div key={label}>
                      <h3>{label}</h3>
                      <div
                        className="proof-scroll"
                        ref={(el) => {
                          scrolls.current[i] = el;
                        }}
                        onScroll={synchronize}
                      >
                        <img
                          src={src || undefined}
                          alt={label}
                          width={proof.width}
                          height={proof.height}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="proof-caption">
                  출력 좌표 {proof.left}, {proof.top} · {proof.width} ×{' '}
                  {proof.height}px · 두 화면의 이동이 동기화됩니다.
                </p>
              </>
            ) : (
              <p className="proof-loading">
                검사를 완료하지 못했습니다. 알림 내용을 확인한 뒤 다시
                시도하세요.
              </p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
