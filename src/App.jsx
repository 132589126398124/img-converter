import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  Image as ImageIcon,
  Download,
  CheckCircle2,
  Loader2,
  X,
  Settings2,
  Trash2,
  Play,
  Package,
  AlertTriangle,
  Moon,
  Sun,
  Eye,
  RefreshCw,
  Sparkles,
  Sliders,
  ShieldCheck,
  Camera,
  Maximize2,
  Columns,
  Layers
} from 'lucide-react';
import JSZip from 'jszip';
import { processImage, processImageForInstagram, isAvifSupported } from './utils/imageProcessor';
import CompareModal from './components/CompareModal';
import './App.css';

const LONG_EDGE_PRESETS = [
  { label: '원본 유지', value: 0 },
  { label: '4096px (Ultra)', value: 4096 },
  { label: '3840px (4K)', value: 3840 },
  { label: '2560px (2K)', value: 2560 },
  { label: '2048px (SNS)', value: 2048 },
  { label: '1920px (FHD)', value: 1920 },
  { label: '1080px (모바일)', value: 1080 },
  { label: '직접 입력', value: -1 },
];

const QUALITY_PRESETS = [
  { label: '100% (무손실/최고)', value: 100 },
  { label: '95% (초고화질)', value: 95 },
  { label: '90% (고화질 추천)', value: 90 },
  { label: '85% (균형)', value: 85 },
  { label: '75% (웹 최적화)', value: 75 },
];

const SIZE_PRESETS = [
  { label: '원본', value: 0 },
  { label: '20MB', value: 20 },
  { label: '10MB', value: 10 },
  { label: '5MB', value: 5 },
  { label: '2MB', value: 2 },
  { label: '1MB', value: 1 },
];

function App() {
  const [images, setImages] = useState([]);
  const [instagramMode, setInstagramMode] = useState(false);
  const [format, setFormat] = useState('webp');
  const [avifSupported, setAvifSupported] = useState(false);

  // Long edge settings
  const [targetLongEdge, setTargetLongEdge] = useState(0); // 0 = original
  const [customLongEdge, setCustomLongEdge] = useState('1920');
  const [preventUpscale, setPreventUpscale] = useState(true);

  // Quality settings
  const [qualityMode, setQualityMode] = useState('quality'); // 'quality' | 'size'
  const [qualityPercent, setQualityPercent] = useState(90);
  const [targetSizeMB, setTargetSizeMB] = useState(10);

  // Advanced settings
  const [preserveExif, setPreserveExif] = useState(true);
  const [fileNamePrefix, setFileNamePrefix] = useState('timestamp'); // 'timestamp' | 'none'

  // Instagram mode settings
  const [instaFrameMode, setInstaFrameMode] = useState('white'); // 'none' | 'white' | 'black' | 'blur'
  const [instaTargetLongEdge, setInstaTargetLongEdge] = useState(2160);
  const [instaSplitMode, setInstaSplitMode] = useState('none'); // 'none' | '2' | '3'
  const [instaSplitFit, setInstaSplitFit] = useState('crop'); // 'crop' | 'fit'
  const [activeSliceMap, setActiveSliceMap] = useState({}); // { [imgId]: sliceIndex }

  // UI state
  const [isDragging, setIsDragging] = useState(false);
  const [isGlobalDragging, setIsGlobalDragging] = useState(false);
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const [activeCompareImage, setActiveCompareImage] = useState(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const dragCounter = useRef(0);

  // Check AVIF support
  useEffect(() => {
    setAvifSupported(isAvifSupported());
  }, []);

  // Theme effect
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
  };

  const handleFiles = useCallback((files) => {
    if (!files || files.length === 0) return;
    const incomingFiles = Array.from(files).filter(file => {
      const name = file.name.toLowerCase();
      return file.type.startsWith('image/') ||
        name.endsWith('.tif') || name.endsWith('.tiff') ||
        name.endsWith('.dng') || name.endsWith('.heic') ||
        name.endsWith('.heif') || name.endsWith('.webp') ||
        name.endsWith('.avif');
    });

    if (incomingFiles.length === 0) return;

    setImages(prev => {
      // Deduplicate: avoid adding identical files if they already exist in the list
      const existingKeys = new Set(
        prev.map(img => `${img.name}_${img.file.size}_${img.file.lastModified}`)
      );

      const uniqueNewImages = [];
      for (const file of incomingFiles) {
        const key = `${file.name}_${file.size}_${file.lastModified}`;
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          uniqueNewImages.push({
            id: Math.random().toString(36).substring(2, 11) + Date.now().toString(36),
            file,
            name: file.name,
            status: 'pending',
            result: null,
            error: null,
          });
        }
      }

      return [...uniqueNewImages, ...prev];
    });
  }, []);

  // Window-level Drag and Drop to prevent accidental navigation
  useEffect(() => {
    const handleDragEnter = (e) => {
      e.preventDefault();
      dragCounter.current += 1;
      if (e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
        setIsGlobalDragging(true);
      }
    };

    const handleDragLeave = (e) => {
      e.preventDefault();
      dragCounter.current -= 1;
      if (dragCounter.current <= 0) {
        setIsGlobalDragging(false);
        dragCounter.current = 0;
      }
    };

    const handleDragOver = (e) => {
      e.preventDefault();
    };

    const handleDrop = (e) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsGlobalDragging(false);
      setIsDragging(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [handleFiles]);

  const onDropZoneDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    // Files are captured globally by the window drop listener to prevent 2x duplicate additions
  };

  const effectiveLongEdge = targetLongEdge === -1 ? (parseInt(customLongEdge, 10) || 0) : targetLongEdge;

  // Single image conversion helper
  const convertSingleImage = async (img) => {
    if (instagramMode) {
      return await processImageForInstagram(img.file, {
        frameMode: instaFrameMode,
        targetLongEdge: instaTargetLongEdge,
        preserveExif,
        splitMode: instaSplitMode,
        splitFit: instaSplitFit,
      });
    } else {
      return await processImage(img.file, {
        format,
        targetLongEdge: effectiveLongEdge,
        preventUpscale,
        qualityMode,
        qualityPercent,
        maxSizeMB: targetSizeMB,
        preserveExif,
      });
    }
  };

  // Concurrency Pool Batch Converter (processes 2~3 images simultaneously)
  const startConversion = async () => {
    const pendingImages = images.filter(img => img.status === 'pending');
    if (pendingImages.length === 0) return;

    setIsProcessingAll(true);
    const total = pendingImages.length;
    let completedCount = 0;
    setProgress({ current: 0, total });

    const CONCURRENCY = 2; // balanced concurrency for mobile/desktop memory
    let currentIndex = 0;

    const worker = async () => {
      while (currentIndex < pendingImages.length) {
        const img = pendingImages[currentIndex++];
        if (!img) break;

        setImages(prev => prev.map(i => i.id === img.id ? { ...i, status: 'working' } : i));

        const result = await convertSingleImage(img);

        completedCount++;
        setProgress({ current: completedCount, total });

        setImages(prev => prev.map(i => {
          if (i.id !== img.id) return i;
          if (i.result?.slices) {
            i.result.slices.forEach(s => { if (s.preview) URL.revokeObjectURL(s.preview); });
          } else if (i.result?.preview) {
            URL.revokeObjectURL(i.result.preview);
          }
          return {
            ...i,
            status: result.success ? 'done' : 'error',
            result: result.success ? result : null,
            error: result.success ? null : result.error,
          };
        }));
      }
    };

    const workers = Array.from({ length: Math.min(CONCURRENCY, pendingImages.length) }, () => worker());
    await Promise.all(workers);

    setIsProcessingAll(false);
  };

  // Retry individual image
  const retryImage = async (id) => {
    const target = images.find(img => img.id === id);
    if (!target) return;

    setImages(prev => prev.map(i => i.id === id ? { ...i, status: 'working', error: null } : i));
    const result = await convertSingleImage(target);

    setImages(prev => prev.map(i => {
      if (i.id !== id) return i;
      if (i.result?.slices) {
        i.result.slices.forEach(s => { if (s.preview) URL.revokeObjectURL(s.preview); });
      } else if (i.result?.preview) {
        URL.revokeObjectURL(i.result.preview);
      }
      return {
        ...i,
        status: result.success ? 'done' : 'error',
        result: result.success ? result : null,
        error: result.success ? null : result.error,
      };
    }));
  };

  const removeImage = (id) => {
    setImages(prev => {
      const target = prev.find(img => img.id === id);
      if (target?.result?.slices) {
        target.result.slices.forEach(s => { if (s.preview) URL.revokeObjectURL(s.preview); });
      } else if (target?.result?.preview) {
        URL.revokeObjectURL(target.result.preview);
      }
      return prev.filter(img => img.id !== id);
    });
  };

  const getFormattedTimestamp = () => {
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    const yy = String(now.getFullYear()).slice(-2);
    const mm = pad(now.getMonth() + 1);
    const dd = pad(now.getDate());
    const hh = pad(now.getHours());
    const min = pad(now.getMinutes());
    const sec = pad(now.getSeconds());
    return `${yy}${mm}${dd}_${hh}${min}${sec}`;
  };

  const buildOutputFileName = (img, timestamp, sliceIndex = null) => {
    const baseName = img.name.replace(/\.[^.]+$/, '');
    const ext = img.result.format;
    const prefix = fileNamePrefix === 'timestamp' ? `${timestamp || getFormattedTimestamp()}_` : '';
    if (sliceIndex !== null) {
      const padIdx = String(sliceIndex).padStart(2, '0');
      return `${prefix}${baseName}_part${padIdx}.${ext}`;
    }
    return `${prefix}${baseName}.${ext}`;
  };

  const downloadImage = (img, specificSliceIdx = null) => {
    if (!img.result) return;
    if (img.result.isSplit && img.result.slices && img.result.slices.length > 1) {
      if (specificSliceIdx !== null) {
        const slice = img.result.slices[specificSliceIdx];
        if (slice) {
          const link = document.createElement('a');
          link.href = slice.preview;
          link.download = buildOutputFileName(img, null, slice.index);
          link.click();
        }
      } else {
        // Download all slices sequentially with small interval to prevent browser block
        img.result.slices.forEach((slice, idx) => {
          setTimeout(() => {
            const link = document.createElement('a');
            link.href = slice.preview;
            link.download = buildOutputFileName(img, null, slice.index);
            link.click();
          }, idx * 180);
        });
      }
    } else {
      const link = document.createElement('a');
      link.href = img.result.preview;
      link.download = buildOutputFileName(img);
      link.click();
    }
  };

  const downloadAllAsZip = async () => {
    const completedImages = images.filter(img => img.status === 'done');
    if (completedImages.length === 0) return;

    setIsZipping(true);
    const zip = new JSZip();
    const batchTimestamp = getFormattedTimestamp();

    for (const img of completedImages) {
      if (img.result?.isSplit && img.result.slices && img.result.slices.length > 1) {
        img.result.slices.forEach(slice => {
          const fileName = buildOutputFileName(img, batchTimestamp, slice.index);
          zip.file(fileName, slice.file);
        });
      } else {
        const fileName = buildOutputFileName(img, batchTimestamp);
        zip.file(fileName, img.result.file);
      }
    }

    const content = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = `lumina_converted_${batchTimestamp}.zip`;
    link.click();
    setIsZipping(false);
  };

  const clearAll = () => {
    setImages(prev => {
      prev.forEach(img => {
        if (img?.result?.slices) {
          img.result.slices.forEach(s => { if (s.preview) URL.revokeObjectURL(s.preview); });
        } else if (img?.result?.preview) {
          URL.revokeObjectURL(img.result.preview);
        }
      });
      return [];
    });
  };

  return (
    <div className="app-container">
      {/* Global Drag Overlay */}
      <AnimatePresence>
        {isGlobalDragging && (
          <motion.div
            className="global-drag-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="drag-backdrop-card glass">
              <Upload size={48} className="text-accent animate-bounce" />
              <h2>어디든 사진을 놓으세요!</h2>
              <p>JPG, PNG, WebP, AVIF, TIFF, HEIC, DNG 등 모든 포맷 지원</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="header">
        <div className="header-top-row">
          <div className="logo-badge">Lumina Flow 2.0</div>
          <button className="theme-toggle-btn" onClick={toggleTheme} title="테마 변경">
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
        >
          <h1>이미지의 흐름을<br />더 선명하고 가볍게</h1>
          <p>손실 없는 초고화질 리사이징 & 메타데이터 보존 스튜디오</p>
        </motion.div>
      </header>

      {/* Main Area */}
      <motion.div
        className="main-area"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.6 }}
      >
        {/* Dropzone */}
        <div
          className={`dropzone glass ${isDragging ? 'active' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDropZoneDrop}
          onClick={() => document.getElementById('fileInput').click()}
        >
          <input
            type="file"
            id="fileInput"
            multiple
            hidden
            accept="image/*,.tif,.tiff,.heic,.heif,.dng,.avif"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <div className="dropzone-content">
            <div className="icon-wrapper">
              <Upload size={32} />
            </div>
            <h2>사진을 여기에 드래그하거나 클릭하여 추가</h2>
            <p>JPG, PNG, WebP, AVIF, TIFF, HEIC, DNG 지원 • 여러 장 동시 선택 가능</p>
          </div>
        </div>

        {/* Settings Panel */}
        <div className="settings-panel glass">
          <div className="settings-header">
            <div className="settings-title">
              <Settings2 size={18} />
              <span>변환 설정</span>
            </div>
            <div className="mode-selector">
              <button
                className={`mode-btn ${!instagramMode ? 'active' : ''}`}
                onClick={() => setInstagramMode(false)}
              >
                <Sparkles size={14} /> 기본 변환
              </button>
              <button
                className={`mode-btn ${instagramMode ? 'active' : ''}`}
                onClick={() => setInstagramMode(true)}
              >
                <Camera size={14} /> 인스타그램 최적화
              </button>
            </div>
          </div>

          {!instagramMode ? (
            <div className="settings-sections">
              {/* Feature 2: Long Edge Resizing */}
              <div className="setting-card">
                <div className="card-heading">
                  <div className="heading-left">
                    <Maximize2 size={16} className="text-accent" />
                    <label>장축(Long Edge) 기준 리사이즈</label>
                  </div>
                  <span className="heading-tip">가로/세로 비율 100% 자동 유지</span>
                </div>

                <div className="preset-chip-group">
                  {LONG_EDGE_PRESETS.map(preset => (
                    <button
                      key={preset.value}
                      className={`chip-btn ${targetLongEdge === preset.value ? 'active' : ''}`}
                      onClick={() => setTargetLongEdge(preset.value)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {targetLongEdge === -1 && (
                  <div className="custom-input-row">
                    <span className="custom-label">장축 길이 직접 지정:</span>
                    <div className="custom-input-wrap">
                      <input
                        type="number"
                        min="100"
                        max="16384"
                        value={customLongEdge}
                        onChange={(e) => setCustomLongEdge(e.target.value)}
                        placeholder="예: 1920"
                      />
                      <span className="input-unit">px</span>
                    </div>
                  </div>
                )}

                <div className="checkbox-row">
                  <label className="custom-checkbox">
                    <input
                      type="checkbox"
                      checked={preventUpscale}
                      onChange={(e) => setPreventUpscale(e.target.checked)}
                    />
                    <span>작은 사진 확대 방지 (원본이 지정 크기보다 작으면 화질 유지를 위해 확대하지 않음)</span>
                  </label>
                </div>
              </div>

              {/* Format & Quality Control */}
              <div className="settings-grid">
                {/* Target Format */}
                <div className="setting-box">
                  <label>목표 포맷</label>
                  <div className="format-selector">
                    <button
                      className={`format-btn ${format === 'webp' ? 'active' : ''}`}
                      onClick={() => setFormat('webp')}
                    >
                      <strong>WebP</strong>
                      <small>추천 • 고압축</small>
                    </button>
                    <button
                      className={`format-btn ${format === 'jpg' ? 'active' : ''}`}
                      onClick={() => setFormat('jpg')}
                    >
                      <strong>JPEG</strong>
                      <small>호환성 최고</small>
                    </button>
                    <button
                      className={`format-btn ${format === 'png' ? 'active' : ''}`}
                      onClick={() => setFormat('png')}
                    >
                      <strong>PNG</strong>
                      <small>무손실 • 투명</small>
                    </button>
                    {avifSupported && (
                      <button
                        className={`format-btn ${format === 'avif' ? 'active' : ''}`}
                        onClick={() => setFormat('avif')}
                      >
                        <strong>AVIF</strong>
                        <small>차세대 규격</small>
                      </button>
                    )}
                  </div>
                </div>

                {/* Quality / Target Size */}
                <div className="setting-box">
                  <div className="quality-mode-toggle">
                    <label>화질 및 압축 설정</label>
                    <div className="toggle-tabs">
                      <button
                        className={`toggle-tab ${qualityMode === 'quality' ? 'active' : ''}`}
                        onClick={() => setQualityMode('quality')}
                      >
                        화질 기준 (%)
                      </button>
                      <button
                        className={`toggle-tab ${qualityMode === 'size' ? 'active' : ''}`}
                        onClick={() => setQualityMode('size')}
                      >
                        목표 용량 (MB)
                      </button>
                    </div>
                  </div>

                  {qualityMode === 'quality' ? (
                    <div className="quality-controls">
                      <div className="slider-row">
                        <input
                          type="range"
                          min="50"
                          max="100"
                          step="1"
                          value={qualityPercent}
                          onChange={(e) => setQualityPercent(Number(e.target.value))}
                          disabled={format === 'png'}
                        />
                        <span className="slider-val">
                          {format === 'png' ? '무손실' : `${qualityPercent}%`}
                        </span>
                      </div>
                      <div className="size-selector">
                        {QUALITY_PRESETS.map(opt => (
                          <button
                            key={opt.value}
                            className={`size-btn ${qualityPercent === opt.value ? 'active' : ''}`}
                            onClick={() => setQualityPercent(opt.value)}
                            disabled={format === 'png'}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="size-controls">
                      <div className="size-selector">
                        {SIZE_PRESETS.map(opt => (
                          <button
                            key={opt.value}
                            className={`size-btn ${targetSizeMB === opt.value ? 'active' : ''}`}
                            onClick={() => setTargetSizeMB(opt.value)}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      <small className="setting-desc">목표 용량 이내로 사진의 픽셀 손상을 최소화하여 압축합니다.</small>
                    </div>
                  )}
                </div>
              </div>

              {/* Advanced Options Bar */}
              <div className="advanced-options-bar">
                <label className="custom-checkbox">
                  <input
                    type="checkbox"
                    checked={preserveExif}
                    onChange={(e) => setPreserveExif(e.target.checked)}
                  />
                  <ShieldCheck size={16} className="text-success" />
                  <span>EXIF 촬영 메타데이터 보존 (카메라, 렌즈, 촬영일시, 노출 설정 유지)</span>
                </label>

                <div className="file-name-setting">
                  <span>저장 파일명:</span>
                  <button
                    className={`mini-pill ${fileNamePrefix === 'none' ? 'active' : ''}`}
                    onClick={() => setFileNamePrefix('none')}
                  >
                    원본 이름 유지
                  </button>
                  <button
                    className={`mini-pill ${fileNamePrefix === 'timestamp' ? 'active' : ''}`}
                    onClick={() => setFileNamePrefix('timestamp')}
                  >
                    날짜_시간 접두사
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Instagram Mode Settings */
            <div className="instagram-settings-area">
              <div className="insta-hero-card">
                <div className="insta-hero-info">
                  <h4>인스타그램 고화질 최적화 모드</h4>
                  <p>화질 저하가 심했던 기존 소프트웨어 인코더를 완전히 제거하고, Lanczos3 고성능 파이프라인으로 최대 10MB 고화질 JPEG 변환 및 EXIF를 보존합니다.</p>
                </div>
              </div>

              <div className="insta-options-grid">
                {/* Panorama Carousel Slicing Section */}
                <div className="setting-card">
                  <div className="card-heading">
                    <div className="heading-left">
                      <Columns size={16} className="text-accent" />
                      <label>가로사진 파노라마 캐러셀 분할 (Carousel Split)</label>
                    </div>
                    <span className="heading-tip">가로 사진 → 4:5 세로 2장 또는 3장 분할</span>
                  </div>

                  <div className="preset-chip-group">
                    <button
                      className={`chip-btn ${instaSplitMode === 'none' ? 'active' : ''}`}
                      onClick={() => setInstaSplitMode('none')}
                    >
                      분할 안함 (1장)
                    </button>
                    <button
                      className={`chip-btn ${instaSplitMode === '2' ? 'active' : ''}`}
                      onClick={() => setInstaSplitMode('2')}
                    >
                      2장 쪼개기 (2분할 4:5)
                    </button>
                    <button
                      className={`chip-btn ${instaSplitMode === '3' ? 'active' : ''}`}
                      onClick={() => setInstaSplitMode('3')}
                    >
                      3장 쪼개기 (3분할 4:5)
                    </button>
                  </div>

                  {instaSplitMode !== 'none' && (
                    <div className="split-fit-selector">
                      <span className="split-fit-label">분할 맞춤 방식:</span>
                      <button
                        className={`mini-pill ${instaSplitFit === 'crop' ? 'active' : ''}`}
                        onClick={() => setInstaSplitFit('crop')}
                      >
                        화면 꽉 채우기 (여백 없이 크롭)
                      </button>
                      <button
                        className={`mini-pill ${instaSplitFit === 'fit' ? 'active' : ''}`}
                        onClick={() => setInstaSplitFit('fit')}
                      >
                        전체 사진 보존 (여백 채우기)
                      </button>
                    </div>
                  )}

                  <small className="setting-desc">
                    와이드 가로 사진을 인스타그램 피드에서 좌우로 자연스럽게 스와이프하며 이어지는 4:5 세로 규격으로 정밀 분할합니다.
                  </small>
                </div>

                <div className="setting-box">
                  <label>인스타그램 세로 사진 장축(높이) 해상도</label>
                  <div className="preset-chip-group">
                    <button
                      className={`chip-btn ${instaTargetLongEdge === 2160 ? 'active' : ''}`}
                      onClick={() => setInstaTargetLongEdge(2160)}
                    >
                      2160px (고화질 추천)
                    </button>
                    <button
                      className={`chip-btn ${instaTargetLongEdge === 1350 ? 'active' : ''}`}
                      onClick={() => setInstaTargetLongEdge(1350)}
                    >
                      1350px (인스타 표준 4:5)
                    </button>
                    <button
                      className={`chip-btn ${instaTargetLongEdge === 4096 ? 'active' : ''}`}
                      onClick={() => setInstaTargetLongEdge(4096)}
                    >
                      4096px (인스타 최대 한도)
                    </button>
                  </div>
                </div>

                <div className="setting-box">
                  <label>
                    {instaSplitMode !== 'none' && instaSplitFit === 'fit'
                      ? '분할 테두리 여백 프레임 스타일'
                      : '비율 초과 시 무손실 레터박스(여백) 채우기'}
                  </label>
                  <div className="preset-chip-group">
                    <button
                      className={`chip-btn ${instaFrameMode === 'white' ? 'active' : ''}`}
                      onClick={() => setInstaFrameMode('white')}
                    >
                      화이트 프레임 (깔끔)
                    </button>
                    <button
                      className={`chip-btn ${instaFrameMode === 'black' ? 'active' : ''}`}
                      onClick={() => setInstaFrameMode('black')}
                    >
                      블랙 프레임 (모던)
                    </button>
                    <button
                      className={`chip-btn ${instaFrameMode === 'blur' ? 'active' : ''}`}
                      onClick={() => setInstaFrameMode('blur')}
                    >
                      블러 배경 (감성 프레임)
                    </button>
                    <button
                      className={`chip-btn ${instaFrameMode === 'none' ? 'active' : ''}`}
                      onClick={() => setInstaFrameMode('none')}
                    >
                      여백 없음 (크롭 경고)
                    </button>
                  </div>
                  <small className="setting-desc">
                    사진이 인스타 규격을 벗어나도 잘리지 않도록 테두리 여백을 채워 완벽한 구도를 유지합니다.
                  </small>
                </div>
              </div>
            </div>
          )}

          {/* Start Conversion Button & Progress */}
          {images.some(img => img.status === 'pending') && (
            <div className="action-row">
              <button
                className="convert-main-btn"
                onClick={startConversion}
                disabled={isProcessingAll}
              >
                {isProcessingAll ? (
                  <>
                    <Loader2 className="animate-spin" size={20} />
                    <span>변환 진행 중 ({progress.current} / {progress.total})</span>
                  </>
                ) : (
                  <>
                    <Play size={20} fill="currentColor" />
                    <span>
                      {images.filter(i => i.status === 'pending').length}장 사진 고화질 변환 시작하기
                    </span>
                  </>
                )}
              </button>
            </div>
          )}

          {isProcessingAll && progress.total > 0 && (
            <div className="progress-bar-wrap">
              <div
                className="progress-bar-fill"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          )}
        </div>
      </motion.div>

      {/* Results Section */}
      <div className="results-container">
        <div className="results-header">
          <div className="results-title-wrap">
            <h3>작업 목록</h3>
            <span className="badge-counter">{images.length}장</span>
            {images.some(i => i.status === 'done') && (
              <span className="badge-done">
                {images.filter(i => i.status === 'done').length}장 완료
              </span>
            )}
          </div>
          <div className="header-actions">
            {images.length > 0 && (
              <>
                <button className="clear-btn" onClick={clearAll} disabled={isProcessingAll}>
                  <Trash2 size={16} /> 목록 비우기
                </button>
                {images.some(img => img.status === 'done') && (
                  <button className="download-all-btn" onClick={downloadAllAsZip} disabled={isZipping}>
                    {isZipping ? (
                      <><Loader2 className="animate-spin" size={16} /> 압축 중...</>
                    ) : (
                      <><Package size={16} /> 모든 결과 ZIP 다운로드</>
                    )}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Image Grid */}
        <div className="image-grid">
          <AnimatePresence mode="popLayout">
            {images.map((img) => (
              <motion.div
                key={img.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85, y: 10 }}
                className={`image-card glass ${img.status === 'done' ? 'card-done' : ''} ${img.status === 'error' ? 'card-error' : ''}`}
              >
                <div
                  className="card-preview"
                  onClick={() => img.result && setActiveCompareImage(img)}
                  title={img.result ? "클릭하여 비포/애프터 화질 비교" : ""}
                >
                  {img.result ? (
                    <img
                      src={
                        img.result.isSplit && img.result.slices
                          ? (img.result.slices[activeSliceMap[img.id] || 0]?.preview || img.result.preview)
                          : img.result.preview
                      }
                      alt="preview"
                    />
                  ) : (
                    <div className="placeholder-icon">
                      <ImageIcon size={32} />
                    </div>
                  )}

                  {img.result?.isSplit && img.result.slices && (
                    <div className="card-slice-tabs" onClick={(e) => e.stopPropagation()}>
                      {img.result.slices.map((slice, idx) => (
                        <button
                          key={slice.index}
                          className={`card-slice-tab ${(activeSliceMap[img.id] || 0) === idx ? 'active' : ''}`}
                          onClick={() => setActiveSliceMap(prev => ({ ...prev, [img.id]: idx }))}
                        >
                          {slice.index}/{img.result.splitCount}
                        </button>
                      ))}
                    </div>
                  )}

                  {img.status === 'working' && (
                    <div className="processing-overlay">
                      <Loader2 className="animate-spin" size={28} />
                      <span>고화질 처리 중...</span>
                    </div>
                  )}

                  {img.status === 'done' && (
                    <button
                      className="card-inspect-badge"
                      onClick={(e) => { e.stopPropagation(); setActiveCompareImage(img); }}
                      title="화질 & 상세 비교"
                    >
                      <Eye size={14} /> 비교 보기
                    </button>
                  )}
                </div>

                <div className="card-body">
                  <div className="card-title">
                    <h4 title={img.name}>{img.name}</h4>
                    {img.status !== 'working' && (
                      <button className="item-remove-btn" onClick={() => removeImage(img.id)} title="항목 삭제">
                        <X size={15} />
                      </button>
                    )}
                  </div>

                  {/* Resolution & Size Specs */}
                  <div className="card-meta">
                    {img.result ? (
                      <div className="meta-row">
                        <span className="res-badge">
                          {img.result.isSplit ? `각 ${img.result.outputWidth} × ${img.result.outputHeight} px` : `${img.result.outputWidth} × ${img.result.outputHeight} px`}
                        </span>
                        <span className="format-tag">
                          {img.result.isSplit ? `4:5 세로 ${img.result.splitCount}분할` : img.result.format.toUpperCase()}
                        </span>
                      </div>
                    ) : (
                      <div className="meta-row">
                        <span className="size-txt">{(img.file.size / 1024 / 1024).toFixed(2)} MB</span>
                        <span className="status-pill pending">대기 중</span>
                      </div>
                    )}
                  </div>

                  {/* Footer status & Actions */}
                  <div className="card-footer">
                    <div className="card-info">
                      {img.status === 'done' ? (() => {
                        const ratio = parseFloat(img.result.ratio);
                        return (
                          <div className="success-tag">
                            <CheckCircle2 size={13} />
                            <span>
                              {ratio >= 0 ? `${ratio}% 절감` : `${Math.abs(ratio)}% 증가`}
                              {' '}({(img.result.compressedSize / 1024 / 1024).toFixed(2)} MB)
                            </span>
                          </div>
                        );
                      })() : img.status === 'working' ? (
                        <span className="working-txt">고성능 리사이징...</span>
                      ) : img.status === 'error' ? (
                        <span className="error-txt" title={img.error}>
                          변환 실패: {img.error}
                        </span>
                      ) : (
                        <span className="ready-txt">변환 대기</span>
                      )}
                    </div>

                    <div className="card-actions">
                      {img.status === 'error' && (
                        <button className="retry-btn" onClick={() => retryImage(img.id)} title="재시도">
                          <RefreshCw size={14} /> 재시도
                        </button>
                      )}
                      {img.status === 'done' && (
                        <button className="individual-save-btn" onClick={() => downloadImage(img)}>
                          <Download size={14} /> {img.result?.isSplit ? `분할본 ${img.result.splitCount}장 저장` : '저장'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Warning tag if present */}
                  {img.result?.warning && (
                    <div className="warning-tag">
                      <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                      <span>{img.result.warning}</span>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Compare Modal */}
      {activeCompareImage && (
        <CompareModal
          image={activeCompareImage}
          onClose={() => setActiveCompareImage(null)}
          onDownload={downloadImage}
        />
      )}
    </div>
  );
}

export default App;
