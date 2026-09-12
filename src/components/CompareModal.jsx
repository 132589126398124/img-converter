import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, ZoomIn, ZoomOut, Sparkles, Camera, CheckCircle2, ArrowRight } from 'lucide-react';

export default function CompareModal({ image, onClose, onDownload }) {
  const [viewMode, setViewMode] = useState('split'); // 'split' | 'converted' | 'original'
  const [isZoomed, setIsZoomed] = useState(false);

  if (!image || !image.result) return null;

  const { result, file } = image;
  const origSizeMB = (file.size / (1024 * 1024)).toFixed(2);
  const compSizeMB = (result.compressedSize / (1024 * 1024)).toFixed(2);
  const ratio = parseFloat(result.ratio);
  const origPreview = URL.createObjectURL(file);

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
              <span className="file-name-pill">{image.name}</span>
            </div>
            <button className="modal-close-btn" onClick={onClose}>
              <X size={20} />
            </button>
          </div>

          {/* Metrics comparison bar */}
          <div className="metrics-bar">
            <div className="metric-card">
              <span className="metric-label">해상도 (가로 × 세로)</span>
              <div className="metric-val">
                <span>{result.originalWidth} × {result.originalHeight}</span>
                <ArrowRight size={14} className="metric-arrow" />
                <strong className="text-accent">{result.outputWidth} × {result.outputHeight}</strong>
              </div>
            </div>

            <div className="metric-card">
              <span className="metric-label">파일 용량</span>
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
              <span className="metric-label">포맷</span>
              <div className="metric-val">
                <span>{file.name.split('.').pop().toUpperCase()}</span>
                <ArrowRight size={14} className="metric-arrow" />
                <strong className="format-highlight">{result.format.toUpperCase()}</strong>
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
                <CheckCircle2 size={12} /> EXIF 메타데이터 보존됨
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
              <button
                className={`tab-btn ${viewMode === 'converted' ? 'active' : ''}`}
                onClick={() => setViewMode('converted')}
              >
                변환본 ({result.format.toUpperCase()})
              </button>
              <button
                className={`tab-btn ${viewMode === 'original' ? 'active' : ''}`}
                onClick={() => setViewMode('original')}
              >
                원본
              </button>
            </div>

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
                    <span className="text-accent">변환본 ({result.format.toUpperCase()})</span>
                    <small>{result.outputWidth} × {result.outputHeight} • {compSizeMB} MB</small>
                  </div>
                  <div className="viewport-inner">
                    <img src={result.preview} alt="Converted" />
                  </div>
                </div>
              </div>
            )}

            {viewMode === 'converted' && (
              <div className="single-view-wrap">
                <div className="column-label">
                  <span className="text-accent">변환본 ({result.format.toUpperCase()})</span>
                  <small>{result.outputWidth} × {result.outputHeight} • {compSizeMB} MB</small>
                </div>
                <div className="viewport-inner">
                  <img src={result.preview} alt="Converted" />
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
              <Download size={16} /> 변환본 저장하기
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
