import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Image as ImageIcon, Download, CheckCircle2, Loader2, X, Settings2, Trash2, Play, Package } from 'lucide-react';
import JSZip from 'jszip';
import { processImage } from './utils/imageProcessor';
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
  const [targetSize, setTargetSize] = useState(20);
  const [format, setFormat] = useState('webp');
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [isZipping, setIsZipping] = useState(false);

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
      const result = await processImage(img.file, { maxSizeMB: targetSize, format });
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
    setImages(prev => prev.filter(img => img.id !== id));
  };

  const downloadImage = (img) => {
    if (!img.result) return;
    const link = document.createElement('a');
    link.href = img.result.preview;
    link.download = `lumina_${img.name.split('.')[0]}.${format}`;
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
    
    for (const img of completedImages) {
      const response = await fetch(img.result.preview);
      const blob = await response.blob();
      const fileName = `lumina_${img.name.split('.')[0]}.${format}`;
      zip.file(fileName, blob);
    }

    const content = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    
    // 포맷명을 대문자로 변환하여 파일명 구성
    const formatName = format.toUpperCase();
    link.download = `${formatName}_converted_${getTimestamp()}.zip`;
    
    link.click();
    setIsZipping(false);
  };

  const clearAll = () => {
    setImages([]);
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
            accept="image/*,.tif,.tiff"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <div className="dropzone-content">
            <div className="icon-wrapper">
              <Upload size={32} />
            </div>
            <h2>사진을 여기에 드래그하세요</h2>
            <p>JPG, PNG, WebP, TIFF 지원</p>
          </div>
        </div>

        <div className="settings-panel glass">
          <div className="settings-header">
            <Settings2 size={18} />
            <span>변환 설정</span>
          </div>
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
                    {img.status === 'pending' && (
                      <button className="item-remove-btn" onClick={() => removeImage(img.id)}>
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  <div className="card-footer">
                    <div className="card-info">
                      {img.status === 'done' ? (
                        <div className="success-tag">
                          <CheckCircle2 size={12} />
                          <span>{img.result.ratio}% 절감 ({(img.result.compressedSize / 1024 / 1024).toFixed(2)} MB)</span>
                        </div>
                      ) : img.status === 'working' ? (
                        <span className="working-txt">변환 중...</span>
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
