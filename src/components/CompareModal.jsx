import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, ZoomIn, ZoomOut, Sparkles, Camera, CheckCircle2, ArrowRight, Layers } from 'lucide-react';

export default function CompareModal({ image, onClose, onDownload }) {
  const [viewMode, setViewMode] = useState('split'); // 'split' | 'converted' | 'original' | 'panorama'
  const [selectedSliceIdx, setSelectedSliceIdx] = useState(0);
  const [isZoomed, setIsZoomed] = useState(false);

  if (!image || !image.result) return null;

  const { result, file } = image;
  const origSizeMB = (file.size / (1024 * 1024)).toFixed(2);
  const compSizeMB = (result.compressedSize / (1024 * 1024)).toFixed(2);
  const ratio = parseFloat(result.ratio);
  const origPreview = URL.createObjectURL(file);

  const isSplit = !!result.isSplit && result.slices && result.slices.length > 1;
  const currentSlice = isSplit ? result.slices[selectedSliceIdx] || result.slices[0] : null;
  const activeConvertedPreview = isSplit ? currentSlice.preview : result.preview;

  return (
    <AnimatePresence>
      <div className="modal-backdrop" onClick={onClose}>
        <motion.div
          className="modal-content glass"
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.25 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="modal-header">
            <div className="modal-title-wrap">
              <Sparkles size={20} className="text-accent" />
              <h3>화질 & 상세 정보 비교</h3>
              {isSplit && (
                <span className="split-badge-pill">
                  <Layers size={13} /> {result.splitCount}분할 파노라마 캐러셀
                </span>
              )}
              <span className="file-name-pill">{image.name}</span>
            </div>
            <button className="modal-close-btn" onClick={onClose}>
              <X size={20} />
            </button>
          </div>

          {/* Metrics comparison bar */}
          <div className="metrics-bar">
            <div className="metric-card">
              <span className="metric-label">
                {isSplit ? `해상도 (원본 → 각 컷 ${result.splitCount}장)` : '해상도 (가로 × 세로)'}
              </span>
              <div className="metric-val">
                <span>{result.originalWidth} × {result.originalHeight}</span>
                <ArrowRight size={14} className="metric-arrow" />
                <strong className="text-accent">
                  {isSplit ? `${result.outputWidth} × ${result.outputHeight} (4:5 × ${result.splitCount}장)` : `${result.outputWidth} × ${result.outputHeight}`}
                </strong>
              </div>
            </div>

            <div className="metric-card">
              <span className="metric-label">
                {isSplit ? `총 파일 용량 (${result.splitCount}장 합계)` : '파일 용량'}
              </span>
              <div className="metric-val">
                <span>{origSizeMB} MB</span>
                <ArrowRight size={14} className="metric-arrow" />
                <strong>{compSizeMB} MB</strong>
                <span className={`pill-badge ${ratio >= 0 ? 'badge-success' : 'badge-danger'}`}>
                  {ratio >= 0 ? `${ratio}% 절감` : `${Math.abs(ratio)}% 증가`}
                </span>
              </div>
            </div>

            <div className="metric-card">
              <span className="metric-label">포맷 & 세팅</span>
              <div className="metric-val">
                <span>{file.name.split('.').pop().toUpperCase()}</span>
                <ArrowRight size={14} className="metric-arrow" />
                <strong className="format-highlight">
                  {result.format.toUpperCase()}
                  {isSplit ? ` (4:5 세로 ${result.splitCount}분할)` : ''}
                </strong>
              </div>
            </div>
          </div>

          {/* EXIF metadata if present */}
          {result.exif && (result.exif.camera || result.exif.exposureSummary) && (
            <div className="exif-bar">
              <Camera size={16} className="text-secondary" />
              <span className="exif-text">
                {[result.exif.camera, result.exif.lens, result.exif.exposureSummary, result.exif.dateTime].filter(Boolean).join(' • ')}
              </span>
              <span className="exif-saved-pill">
                <CheckCircle2 size={12} /> EXIF 메타데이터 {isSplit ? '모든 분할본에 ' : ''}보존됨
              </span>
            </div>
          )}

          {/* View Toolbar */}
          <div className="view-toolbar">
            <div className="view-mode-tabs">
              <button
                className={`tab-btn ${viewMode === 'split' ? 'active' : ''}`}
                onClick={() => setViewMode('split')}
              >
                나란히 비교
              </button>
              {isSplit && (
                <button
                  className={`tab-btn ${viewMode === 'panorama' ? 'active' : ''}`}
                  onClick={() => setViewMode('panorama')}
                >
                  연속 파노라마 연결 뷰
                </button>
              )}
              <button
                className={`tab-btn ${viewMode === 'converted' ? 'active' : ''}`}
                onClick={() => setViewMode('converted')}
              >
                변환본 {isSplit ? `(${selectedSliceIdx + 1}/${result.splitCount})` : `(${result.format.toUpperCase()})`}
              </button>
              <button
                className={`tab-btn ${viewMode === 'original' ? 'active' : ''}`}
                onClick={() => setViewMode('original')}
              >
                원본
              </button>
            </div>

            {/* If split, show slice switch pills */}
            {isSplit && viewMode !== 'panorama' && (
              <div className="slice-switch-group">
                <span className="slice-switch-label">컷 선택:</span>
                {result.slices.map((slice, idx) => (
                  <button
                    key={slice.index}
                    className={`slice-switch-pill ${selectedSliceIdx === idx ? 'active' : ''}`}
                    onClick={() => setSelectedSliceIdx(idx)}
                  >
                    {slice.index}번 컷
                  </button>
                ))}
              </div>
            )}

            <div className="zoom-toggle">
              <button
                className="zoom-btn"
                onClick={() => setIsZoomed(!isZoomed)}
                title={isZoomed ? "화면에 맞추기" : "100% 원본 픽셀로 확대"}
              >
                {isZoomed ? <ZoomOut size={16} /> : <ZoomIn size={16} />}
                <span>{isZoomed ? "화면에 맞춤" : "1:1 확대"}</span>
              </button>
            </div>
          </div>

          {/* Image Viewport */}
          <div className={`compare-viewport ${isZoomed ? 'zoomed' : ''}`}>
            {viewMode === 'split' && (
              <div className="split-view-grid">
                <div className="image-column">
                  <div className="column-label">
                    <span>원본 (Original)</span>
                    <small>{result.originalWidth} × {result.originalHeight} • {origSizeMB} MB</small>
                  </div>
                  <div className="viewport-inner">
                    <img src={origPreview} alt="Original" />
                  </div>
                </div>
                <div className="image-column">
                  <div className="column-label">
                    <span className="text-accent">
                      변환본 {isSplit ? `(${selectedSliceIdx + 1}/${result.splitCount}번 컷)` : `(${result.format.toUpperCase()})`}
                    </span>
                    <small>
                      {isSplit ? `${currentSlice.width} × ${currentSlice.height} • ${(currentSlice.size / 1024 / 1024).toFixed(2)} MB` : `${result.outputWidth} × ${result.outputHeight} • ${compSizeMB} MB`}
                    </small>
                  </div>
                  <div className="viewport-inner">
                    <img src={activeConvertedPreview} alt="Converted" />
                  </div>
                </div>
              </div>
            )}

            {viewMode === 'panorama' && isSplit && (
              <div className="panorama-strip-wrap">
                <div className="column-label">
                  <span className="text-accent">연속 파노라마 캐러셀 이어보기 ({result.splitCount}장 4:5 세로)</span>
                  <small>인스타그램에 올렸을 때 옆으로 스와이프하며 끊김 없이 이어집니다.</small>
                </div>
                <div className="panorama-seamless-container">
                  {result.slices.map((slice, i) => (
                    <div key={slice.index} className="panorama-seamless-slice">
                      <img src={slice.preview} alt={`Slice ${slice.index}`} />
                      <div className="slice-watermark">
                        <span>{slice.index} / {result.splitCount}</span>
                      </div>
                      {i < result.slices.length - 1 && <div className="seamless-seam-line" />}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {viewMode === 'converted' && (
              <div className="single-view-wrap">
                <div className="column-label">
                  <span className="text-accent">
                    변환본 {isSplit ? `(${selectedSliceIdx + 1}/${result.splitCount}번 컷 - 4:5 세로)` : `(${result.format.toUpperCase()})`}
                  </span>
                  <small>
                    {isSplit ? `${currentSlice.width} × ${currentSlice.height} • ${(currentSlice.size / 1024 / 1024).toFixed(2)} MB` : `${result.outputWidth} × ${result.outputHeight} • ${compSizeMB} MB`}
                  </small>
                </div>
                <div className="viewport-inner">
                  <img src={activeConvertedPreview} alt="Converted" />
                </div>
              </div>
            )}

            {viewMode === 'original' && (
              <div className="single-view-wrap">
                <div className="column-label">
                  <span>원본 (Original)</span>
                  <small>{result.originalWidth} × {result.originalHeight} • {origSizeMB} MB</small>
                </div>
                <div className="viewport-inner">
                  <img src={origPreview} alt="Original" />
                </div>
              </div>
            )}
          </div>

          {/* Modal Footer */}
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>
              닫기
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                onDownload(image);
              }}
            >
              <Download size={16} />
              <span>
                {isSplit ? `모든 분할본(${result.splitCount}장) 저장하기` : '변환본 저장하기'}
              </span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
