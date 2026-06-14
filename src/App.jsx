import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Image as ImageIcon, Download, CheckCircle2, Loader2, X, Settings2, Trash2, Play, Package, AlertTriangle } from 'lucide-react';
import JSZip from 'jszip';
import { processImage, processImageForInstagram } from './utils/imageProcessor';
import './App.css';

const SIZE_OPTIONS = [
  { label: '원본', value: 0 },
  { label: '20MB', value: 20 },
  { label: '10MB', value: 10 },
  { label: '5MB', value: 5 },
  { label: '1MB', value: 1 },
];

function App() {
  const [images, setImages] = useState([]);
  const [targetSize, setTargetSize] = useState(0);
  const [format, setFormat] = useState('webp');
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [instagramMode, setInstagramMode] = useState(false);

  const handleFiles = useCallback((files) => {
    const newImages = Array.from(files).map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      name: file.name,
      status: 'pending',
      result: null
    }));
    setImages(prev => [...newImages, ...prev]);
  }, []);

  const startConversion = async () => {
    const pendingImages = images.filter(img => img.status === 'pending');
    if (pendingImages.length === 0) return;

    setIsProcessingAll(true);
    for (const img of pendingImages) {
      setImages(prev => prev.map(i => i.id === img.id ? { ...i, status: 'working' } : i));
      const result = instagramMode
        ? await processImageForInstagram(img.file)
        : await processImage(img.file, { maxSizeMB: targetSize, format });
      setImages(prev => prev.map(i => i.id === img.id ? { 
        ...i, 
        status: result.success ? 'done' : 'error',
        result: result.success ? result : null,
        error: result.success ? null : result.error
      } : i));
    }
    setIsProcessingAll(false);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const removeImage = (id) => {
    setImages(prev => {
      const target = prev.find(img => img.id === id);
      if (target?.result?.preview) URL.revokeObjectURL(target.result.preview);
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
    return `${yy}${mm}${dd}${hh}${min}${sec}`;
  };

  const downloadImage = (img) => {
    if (!img.result) return;
    const link = document.createElement('a');
    link.href = img.result.preview;
    const baseName = img.name.replace(/\.[^.]+$/, '');
    link.download = `${getFormattedTimestamp()}_${baseName}.${img.result.format}`;
    link.click();
  };

  const getTimestamp = () => {
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  };

  const downloadAllAsZip = async () => {
    const completedImages = images.filter(img => img.status === 'done');
    if (completedImages.length === 0) return;

    setIsZipping(true);
    const zip = new JSZip();
    const currentTimestamp = getFormattedTimestamp();

    for (const img of completedImages) {
      const baseName = img.name.replace(/\.[^.]+$/, '');
      const fileName = `${currentTimestamp}_${baseName}.${img.result.format}`;
      zip.file(fileName, img.result.file);
    }

    const content = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = `converted_${currentTimestamp}.zip`;
    
    link.click();
    setIsZipping(false);
  };

  const clearAll = () => {
    setImages(prev => {
      prev.forEach(img => {
        if (img?.result?.preview) URL.revokeObjectURL(img.result.preview);
      });
      return [];
    });
  };

  return (
    <div className="app-container">
      <header className="header" style={{marginBottom: '1rem'}}>
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <div className="logo-badge">Lumina Flow</div>
          <h1>이미지의 흐름을 <br/>더 선명하고 가볍게</h1>
          <p>사진을 올리고 변환 설정을 확인해 보세요.</p>
        </motion.div>
      </header>

      <motion.div 
        className="main-area"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.6 }}
      >
        <div 
          className={`dropzone glass ${isDragging ? 'active' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          onClick={() => document.getElementById('fileInput').click()}
        >
          <input 
            type="file" 
            id="fileInput" 
            multiple 
            hidden 
            accept="image/*,.tif,.tiff,.heic,.heif,.dng"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <div className="dropzone-content">
            <div className="icon-wrapper">
              <Upload size={32} />
            </div>
            <h2>사진을 여기에 드래그하세요</h2>
            <p>JPG, PNG, WebP, TIFF, HEIC, DNG 지원</p>
          </div>
        </div>

        <div className="settings-panel glass">
          <div className="settings-header">
            <Settings2 size={18} />
            <span>변환 설정</span>
          </div>

          <div className="setting-box" style={{ marginBottom: '1.5rem' }}>
            <label>변환 모드</label>
            <div className="mode-selector">
              <button
                className={`mode-btn ${!instagramMode ? 'active' : ''}`}
                onClick={() => setInstagramMode(false)}
              >
                기본
              </button>
              <button
                className={`mode-btn ${instagramMode ? 'active' : ''}`}
                onClick={() => setInstagramMode(true)}
              >
                인스타그램
              </button>
            </div>
          </div>

          {!instagramMode ? (
            <div className="settings-grid">
              <div className="setting-box">
                <label>목표 포맷</label>
                <div className="select-wrapper">
                  <select value={format} onChange={(e) => setFormat(e.target.value)}>
                    <option value="webp">WebP</option>
                    <option value="jpg">JPEG</option>
                    <option value="png">PNG</option>
                  </select>
                </div>
              </div>
              <div className="setting-box">
                <label>목표 용량 <span>{SIZE_OPTIONS.find(o => o.value === targetSize)?.label}</span></label>
                <div className="size-selector">
                  {SIZE_OPTIONS.map(option => (
                    <button
                      key={option.value}
                      className={`size-btn ${targetSize === option.value ? 'active' : ''}`}
                      onClick={() => setTargetSize(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="instagram-info">
              <div className="instagram-info-row">
                <span className="instagram-info-label">포맷</span>
                <span>JPEG (자동)</span>
              </div>
              <div className="instagram-info-row">
                <span className="instagram-info-label">최대 해상도</span>
                <span>장축 4096px</span>
              </div>
              <div className="instagram-info-row">
                <span className="instagram-info-label">최대 용량</span>
                <span>10MB</span>
              </div>
              <div className="instagram-info-row">
                <span className="instagram-info-label">지원 화면비</span>
                <span>1.91:1 (가로) ~ 4:5 (세로)</span>
              </div>
            </div>
          )}

          {images.some(img => img.status === 'pending') && (
            <button
              className="convert-main-btn"
              onClick={startConversion}
              disabled={isProcessingAll}
            >
              {isProcessingAll ? (
                <><Loader2 className="animate-spin" size={20} /> 변환 중...</>
              ) : (
                <><Play size={20} fill="currentColor" /> 사진 변환 시작하기</>
              )}
            </button>
          )}
        </div>
      </motion.div>

      <div className="results-container">
        <div className="results-header">
          <h3>작업 목록 <span>{images.length}장</span></h3>
          <div className="header-actions">
            {images.length > 0 && (
              <>
                <button className="clear-btn" onClick={clearAll}>
                  <Trash2 size={16} /> 구성 비우기
                </button>
                {images.some(img => img.status === 'done') && (
                  <button className="download-all-btn" onClick={downloadAllAsZip} disabled={isZipping}>
                    {isZipping ? (
                      <><Loader2 className="animate-spin" size={16} /> 압축 중...</>
                    ) : (
                      <><Package size={16} /> 모든 결과 압축 저장</>
                    )}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <div className="image-grid">
          <AnimatePresence mode="popLayout">
            {images.map((img) => (
              <motion.div 
                key={img.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9, y: 10 }}
                className={`image-card glass ${img.status === 'done' ? 'card-done' : ''}`}
              >
                <div className="card-preview">
                  {img.result ? (
                    <img src={img.result.preview} alt="preview" />
                  ) : (
                    <div className="placeholder-icon">
                      <ImageIcon size={32} />
                    </div>
                  )}
                  {img.status === 'working' && (
                    <div className="processing-overlay">
                      <Loader2 className="animate-spin" size={24} />
                    </div>
                  )}
                </div>
                
                <div className="card-body">
                  <div className="card-title">
                    <h4>{img.name}</h4>
                    {(img.status === 'pending' || img.status === 'error') && (
                      <button className="item-remove-btn" onClick={() => removeImage(img.id)}>
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  <div className="card-footer">
                    <div className="card-info">
                      {img.status === 'done' ? (() => {
                        const ratio = parseFloat(img.result.ratio);
                        return (
                          <div className="success-tag">
                            <CheckCircle2 size={12} />
                            <span>
                              {ratio >= 0 ? `${ratio}% 절감` : `${Math.abs(ratio)}% 증가`}
                              {' '}({(img.result.compressedSize / 1024 / 1024).toFixed(2)} MB)
                            </span>
                          </div>
                        );
                      })() : img.status === 'working' ? (
                        <span className="working-txt">변환 중...</span>
                      ) : img.status === 'error' ? (
                        <span className="error-txt">변환 실패 — {img.error}</span>
                      ) : (
                        <span className="size-txt">대기 중 • {(img.file.size / 1024 / 1024).toFixed(2)} MB</span>
                      )}
                    </div>
                    {img.status === 'done' && (
                      <button className="individual-save-btn" onClick={() => downloadImage(img)}>
                        <Download size={14} /> 저장
                      </button>
                    )}
                  </div>
                  {img.result?.warning && (
                    <div className="warning-tag">
                      <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>{img.result.warning}</span>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

export default App;
