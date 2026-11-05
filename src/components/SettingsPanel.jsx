import {
  Check,
  ChevronDown,
  FileImage,
  Layers,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useDialog } from './useDialog';

export function PurposeButtons({ purpose, onChange, disabled }) {
  return (
    <div className="purpose-buttons">
      {[
        ['quality', '고품질 변환', FileImage, '색과 디테일을 살려 저장'],
        ['size', '용량 맞추기', SlidersHorizontal, '업로드 제한에 맞는 파일'],
        ['social', 'SNS 프레임', Layers, '여백을 더하거나 나눠 담기'],
      ].map(([key, label, Icon, description]) => (
        <button
          key={key}
          aria-label={label}
          aria-pressed={purpose === key}
          disabled={disabled}
          className={purpose === key ? 'active' : ''}
          onClick={() => onChange(key)}
        >
          <Icon size={16} />
          <span>
            <strong>{label}</strong>
            <small>{description}</small>
          </span>
          {purpose === key && <Check size={14} />}
        </button>
      ))}
    </div>
  );
}
function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export default function SettingsPanel({
  recipe: r,
  onChange,
  locked,
  open,
  onClose,
}) {
  const dialog = useRef();
  const [customSize, setCustomSize] = useState(false);
  useDialog(open, dialog, onClose);
  return (
    <aside
      ref={dialog}
      role={open ? 'dialog' : undefined}
      aria-modal={open || undefined}
      className={`inspector ${open ? 'open' : ''}`}
      aria-label="출력 설정"
    >
      <div className="panel-title">
        <h2>출력 설정</h2>
        <span className="settings-label">모든 사진에 적용</span>
        <button
          className="icon-button sheet-close"
          aria-label="설정 닫기"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      <fieldset disabled={locked}>
        <div className="setting-section">
          <span className="setting-number">01 / 목적</span>
          <PurposeButtons
            purpose={r.purpose}
            disabled={locked}
            onChange={(purpose) => onChange({ purpose })}
          />
          {r.purpose === 'size' && (
            <div className="target-budget">
              <Field
                label="목표 용량 · 사진 한 장당"
                hint="이 용량 이하에서 가능한 최고 품질로 저장합니다. 해상도는 자동으로 줄이지 않습니다."
              >
                <div className="unit-input">
                  <input
                    aria-label="최대 용량 MB"
                    type="number"
                    min="0.001"
                    max="1024"
                    step="0.1"
                    value={Number((r.maxBytes / 1048576).toFixed(3))}
                    onChange={(e) =>
                      onChange({
                        maxBytes: Math.max(
                          1,
                          Math.min(
                            1073741824,
                            Math.round((+e.target.value || 0) * 1048576),
                          ),
                        ),
                      })
                    }
                  />
                  <span>MiB</span>
                </div>
              </Field>
              <div className="size-presets">
                {[1, 2, 5].map((size) => (
                  <button
                    type="button"
                    key={size}
                    aria-pressed={r.maxBytes === size * 1048576}
                    onClick={() => onChange({ maxBytes: size * 1048576 })}
                  >
                    {size} MiB
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="setting-section">
          <span className="setting-number">02 / 크기와 품질</span>
          <Field label="출력 포맷">
            <select
              aria-label="출력 포맷"
              value={r.format}
              onChange={(e) => onChange({ format: e.target.value })}
            >
              <option value="jpg">JPG · 사진 호환성</option>
              <option value="webp">WebP · 웹용</option>
              <option value="png">PNG · 무손실</option>
              <option value="avif">AVIF · 고급 압축</option>
            </select>
          </Field>

          <Field
            label="장축 길이"
            hint="가로·세로 비율 유지 · 작은 사진 확대 안 함"
          >
            <select
              aria-label="장축 길이 프리셋"
              value={
                !customSize &&
                [0, 4096, 2560, 2160, 2048, 1920, 1080].includes(r.longEdge)
                  ? r.longEdge
                  : 'custom'
              }
              onChange={(e) => {
                setCustomSize(e.target.value === 'custom');
                onChange({
                  longEdge:
                    e.target.value === 'custom'
                      ? r.longEdge || 2000
                      : +e.target.value,
                });
              }}
            >
              <option value="0">원본 크기 유지</option>
              {[4096, 2560, 2160, 2048, 1920, 1080].map((n) => (
                <option key={n} value={n}>
                  {n.toLocaleString()} px
                </option>
              ))}
              <option value="custom">직접 입력</option>
            </select>
          </Field>
          {(customSize ||
            ![0, 4096, 2560, 2160, 2048, 1920, 1080].includes(r.longEdge)) && (
            <Field label="직접 지정 (px)">
              <div className="unit-input">
                <input
                  type="number"
                  aria-label="장축 직접 지정"
                  min="0"
                  max="30000"
                  value={r.longEdge}
                  onChange={(e) =>
                    onChange({
                      longEdge: Math.max(
                        0,
                        Math.min(30000, +e.target.value || 0),
                      ),
                    })
                  }
                />
                <span>px</span>
              </div>
            </Field>
          )}
          <Field
            label={r.purpose === 'size' ? '최대 인코딩 품질' : '인코딩 품질'}
            hint={
              r.format === 'png'
                ? 'PNG는 무손실 압축입니다.'
                : '100도 손실 압축입니다. 포맷마다 같은 수치의 화질은 다릅니다.'
            }
          >
            <div className="range-row">
              <input
                aria-label="인코딩 품질"
                type="range"
                min="1"
                max="100"
                value={r.quality}
                disabled={locked || r.format === 'png'}
                onChange={(e) => onChange({ quality: +e.target.value })}
              />
              <output>{r.format === 'png' ? '—' : r.quality}</output>
            </div>
          </Field>
        </div>
        {r.purpose === 'social' && (
          <div className="setting-section">
            <span className="setting-number">03 / 구도</span>
            <Field label="파노라마 분할">
              <select
                aria-label="파노라마 분할"
                value={r.slices}
                onChange={(e) => onChange({ slices: +e.target.value })}
              >
                <option value="1">한 장 · 화면비 보호</option>
                <option value="2">4:5 세로 2장</option>
                <option value="3">4:5 세로 3장</option>
              </select>
            </Field>
            <Field label="사진 맞춤">
              <div className="segmented">
                <button
                  className={r.fit === 'contain' ? 'active' : ''}
                  onClick={() => onChange({ fit: 'contain' })}
                >
                  전체 보존
                </button>
                <button
                  className={r.fit === 'cover' ? 'active' : ''}
                  onClick={() => onChange({ fit: 'cover' })}
                >
                  가득 채우기
                </button>
              </div>
            </Field>
            <Field label="여백 배경">
              <select
                aria-label="여백 배경"
                value={r.frame}
                onChange={(e) => onChange({ frame: e.target.value })}
              >
                <option value="white">화이트</option>
                <option value="black">블랙</option>
                <option value="blur">사진 블러</option>
                <option value="none">여백 없음</option>
              </select>
            </Field>
            <p className="field-note">
              분할 경계는 미리보기에 반영됩니다. 가득 채우기는 사진 일부를 자를
              수 있습니다.
            </p>
          </div>
        )}
        <div className="setting-section">
          <span className="setting-number">
            {r.purpose === 'social' ? '04' : '03'} / 촬영정보
          </span>
          <Field label="메타데이터">
            <div className="segmented">
              <button
                className={r.metadata === 'keep' ? 'active' : ''}
                onClick={() => onChange({ metadata: 'keep' })}
              >
                유지
              </button>
              <button
                className={r.metadata === 'strip' ? 'active' : ''}
                onClick={() => onChange({ metadata: 'strip' })}
              >
                제거
              </button>
            </div>
          </Field>
          <label className="check-field">
            <input
              type="checkbox"
              checked={r.gps}
              disabled={locked || r.metadata === 'strip'}
              onChange={(e) => onChange({ gps: e.target.checked })}
            />
            <span>GPS 위치정보도 유지</span>
          </label>
          <p className="field-note">
            지원하는 카메라·렌즈·촬영일·노출·저작권 정보를 보존합니다. 색상용
            ICC는 제거 설정에서도 유지됩니다.
          </p>
        </div>
        <details className="advanced-settings">
          <summary>
            색상 고급 설정
            <ChevronDown size={15} />
          </summary>
          <Field label="출력 색공간">
            <select
              aria-label="출력 색공간"
              value={r.colorSpace}
              onChange={(e) => onChange({ colorSpace: e.target.value })}
            >
              <option value="srgb">sRGB · 웹 호환 (기본)</option>
              <option value="source">원본 RGB ICC 유지</option>
              <option value="p3">Display P3</option>
            </select>
          </Field>
          <Field
            label="입력 프로파일 지정"
            hint="내장 ICC가 없거나 잘못된 경우에만 지정하세요."
          >
            <select
              aria-label="입력 프로파일 지정"
              value={r.inputProfile}
              onChange={(e) => onChange({ inputProfile: e.target.value })}
            >
              <option value="auto">내장 ICC 자동 · 없으면 sRGB</option>
              <option value="srgb">sRGB로 해석</option>
              <option value="adobergb">Adobe RGB로 해석</option>
              <option value="p3">Display P3로 해석</option>
            </select>
          </Field>
          <p className="field-note">
            고비트 정밀도는 중간 처리까지 유지하고 최종 파일은 8비트로
            저장합니다. 추가 샤프닝은 적용하지 않습니다.
          </p>
        </details>
        <div className="settings-footnote">
          <Check size={14} />
          현재 설정은 작업 시작 시 고정됩니다.
        </div>
      </fieldset>
      <button className="button primary sheet-done" onClick={onClose}>
        설정 적용 · 미리보기
      </button>
    </aside>
  );
}
