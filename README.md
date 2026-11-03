# Lumina Flow

사진을 외부 서버로 보내지 않고 변환·검증하는 한국어 웹 사진 스튜디오. React + Vite, Vercel 정적 배포, PC 작업 화면과 모바일 설정 시트를 사용합니다.

## 실행

Node.js 24 권장.

```sh
npm ci
npm run dev
```

`predev` / `prebuild`가 설치된 `wasm-vips@0.0.19`의 런타임·WASM·라이선스를 `public/engine/`에 복사합니다. 해당 폴더는 생성물이며 커밋하지 않습니다. 인터넷에서 사진이나 엔진을 런타임 다운로드하지 않고 동일 출처 정적 파일만 사용합니다. 시스템 폰트를 사용하므로 외부 폰트 요청도 없습니다.

```sh
npm run lint
npm run typecheck
npm test
npm run test:browser
```

로컬 브라우저 검사는 설치된 Chrome을 사용합니다. CI에서는 `npx playwright install --with-deps chromium`으로 테스트 브라우저를 설치합니다.

## 사용과 품질 기준

1. 사진 추가: 실제 파일 형식, 방향을 적용한 해상도, 입력 비트 깊이, ICC, 촬영정보를 확인합니다.
2. 목적 선택: 고품질 변환 / 파일당 용량 제한 / SNS 프레임·파노라마.
3. 미리보기: 동일 recipe의 축소 결과, 연결된 분할 경계, 사진별 크롭 위치를 확인합니다. ‘100% 인코딩 검사’는 선택한 출력 영역의 인코딩 전 픽셀과 실제 인코딩 후 픽셀을 나란히 표시합니다.
4. 일괄 처리: 설정을 고정하고 한 장씩 처리합니다. 일시정지는 현재 사진 완료 후 멈추고, 취소는 현재 Worker를 종료합니다. 완료한 항목은 다시 요청하지 않습니다. 설정이 달라진 완료본은 이전 결과로 표시합니다.
5. 저장: 실제 시그니처, 재디코딩, 해상도, ICC, 메타데이터, 최종 용량을 검사한 파일을 다운로드합니다. 실패한 용량 목표를 ‘완료’로 표시하지 않습니다.

기본값: JPG 품질 95, sRGB, 원본 크기, 확대 방지, 추가 샤프닝 없음, 촬영정보 유지·GPS 제외. JPG/WebP의 품질 100은 무손실 보장이 아닙니다. PNG는 무손실 압축입니다. AVIF도 선택할 수 있습니다.

### 색상과 정밀도

- JPG, 단일 페이지 8/16비트 RGB·회색 TIFF, PNG, 정지 WebP/AVIF를 libvips로 읽습니다.
- LittleCMS ICC import → XYZ float 작업 공간 → Lanczos3 리사이즈 → 대상 ICC 16비트 export → 8비트 양자화 → 인코딩 순서입니다. Canvas는 최종 처리 경로에 없습니다.
- sRGB, 원본 RGB ICC, Display P3 출력을 지원합니다. 내장 ICC가 없으면 sRGB(회색은 같은 TRC의 sGrey) 가정임을 표시합니다. 명시적으로 sRGB / Adobe RGB / Display P3 입력 프로파일을 지정할 수 있습니다.
- 손상된 ICC는 자동 처리를 실패시키며 명시적인 입력 지정으로 재처리할 수 있습니다. CMYK, 부동소수점/HDR, 다중 페이지·애니메이션 입력은 지원하지 않습니다.
- 동일 포맷·원본 색공간·원본 크기·품질 100·정방향 조건에서는 JPEG/WebP 픽셀 데이터를 재압축하지 않고 촬영정보 컨테이너만 정리합니다.

### CR3 / DNG / HEIC

- **CR3와 DNG는 내장 JPEG 추출입니다. RAW 현상이 아닙니다.** 실제 추출 해상도와 출처를 UI·결과에 표시합니다.
- CR3는 ISO-BMFF JPEG 트랙과 PRVW를 탐색하고 픽셀 면적이 가장 큰 유효 후보를 사용합니다. CMT1/2/4의 촬영정보도 읽습니다. DNG는 IFD/SubIFD의 JPEG 위치 정보를 사용하며 임의의 JPEG 마커를 카빙하지 않습니다.
- R6 Mark III RAW/C-RAW 풀프레임·크롭 공개 샘플로 추출과 저장을 검증했습니다. 정밀 RAW 현상은 후속 범위입니다.
- HEIC는 필요할 때만 `heic2any` 보조 디코더를 로딩합니다. **8비트 출력이며 원본 ICC·HDR 보존을 보장하지 않습니다.** 이 제한을 처리 출처와 경고에 표시합니다. 고비트·광색역 작업에는 보정한 TIFF를 사용하세요.

### 메타데이터와 용량

- 유지 대상: 카메라·렌즈, 노출·ISO·초점거리, 촬영일·초 단위 이하·원래 시간대, 작성자·저작권. 날짜를 UTC로 강제 변환하거나 파일 생성일을 촬영일로 사용하지 않습니다.
- EXIF를 화이트리스트로 재구성하고 썸네일·MakerNote·기존 XMP/IPTC/주석은 복사하지 않습니다. GPS는 별도 선택입니다. EXIF ASCII에 표현할 수 없는 값 등 누락은 ‘일부 보존’으로 표시합니다.
- 촬영정보 제거와 색상 ICC 보존은 별개입니다. JPEG 스캔 사이의 메타데이터와 종료 마커 뒤 추가 데이터도 제거합니다.
- 목표 용량은 ICC·촬영정보를 붙인 **최종 바이트 수**입니다. 설정한 최대 품질부터 정수 품질 값을 내려가며 처음 통과한 결과를 선택합니다. 품질과 용량이 항상 단조 관계라고 가정하지 않습니다. 작고 어려운 제한은 오래 걸릴 수 있으며 취소할 수 있습니다. PNG는 한 번 인코딩해 판정합니다.
- 설정한 크기에서 제한을 충족하지 못하면 결과를 ‘목표 미달’로 보관합니다. 해상도를 자동으로 낮추지 않습니다. UI의 MiB는 1,048,576 bytes입니다.

## 구조와 보관

- `src/engine`: typed Worker client, 공통 recipe/기하 규칙, libvips 엔진, 포맷·ICC·메타데이터 검증, CR3/DNG 추출.
- `src/workspace`: 직렬 실행 큐, IndexedDB 결과 보관, 지연 읽기, ZIP Worker.
- `src/components`: PC·모바일 설정, Blob URL 수명 관리, 동일 위치의 픽셀 비교, 연결 파노라마.
- 내부 경계는 `inspect(file)`, `preview(asset, recipe, signal, region?)`, `run(asset, recipe, signal)`입니다. 결과에 실제 포맷·크기·검사·출처·고정 recipe·엔진 버전을 기록합니다. 원격 처리 API는 없습니다.

원본 File은 IndexedDB에 저장하지 않습니다. 완료 파일의 바이트 데이터와 작은 원본 미리보기·작업 정보만 보관합니다. WebKit Blob 저장 제약을 피하도록 ArrayBuffer로 기록하고 다운로드 시 Blob으로 복원합니다. 새로고침 후 완료본을 저장할 수 있으며 미완료 작업이나 설정 변경에는 원본을 다시 선택해야 합니다. 브라우저의 저장소 삭제·자동 회수 이후 영구 복원을 보장하지 않습니다.

저장 공간 부족 시 다음 작업을 멈추고 현재 결과를 메모리에 유지해 다운로드할 수 있게 합니다. 이 경우 탭을 닫으면 현재 임시 결과는 사라집니다. 목록에서 항목을 제거하면 해당 캐시도 지워지며 원본 파일은 건드리지 않습니다.

ZIP은 파일명 충돌을 방지하고 결과 합계 64MiB 단위로 묶습니다. 단일 대형 파일은 분할하지 않습니다. 완성된 ZIP 링크를 각각 눌러 저장합니다. 모바일 공유는 `navigator.canShare({files})`를 검사하고 사용자 클릭에서 준비된 File을 넘깁니다.

보수적인 사전 한도: 터치 기기 50MP/입력 160MiB, 일반 기기 200MP/512MiB. 여백을 포함한 출력에도 픽셀 한도를 적용합니다. 이 수치는 실제 기기 메모리를 측정한 보장치가 아닙니다. 브라우저가 백그라운드 탭을 중단할 수 있으므로 작업 중에는 탭을 열어 두세요.

## 배포

Vercel 설정은 `vercel.json`에 있습니다. `npm run build` → `dist/` 정적 배포이며 문서·Worker·WASM에 다음 헤더가 필요합니다.

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

`crossOriginIsolated`가 활성화되지 않으면 엔진을 시작하지 않습니다. Vite 개발/프리뷰 서버에도 같은 헤더를 설정했습니다. 기존 GitHub Pages 자동 게시 워크플로우는 품질 검사 CI로 교체했습니다. Pages는 이 헤더를 직접 구성하기 어려워 현재 배포 대상으로 삼지 않습니다.

## 검증 자료

로컬 검증의 범위와 실제 기기·출시 전 남은 항목은 [QA.md](QA.md)에 기록합니다.

실제 카메라 회귀 검사는 CC0 샘플(약 70MiB)을 별도로 내려받아 실행합니다. 파일과 해시는 `tests/camera-fixtures.json`에 고정되어 있습니다. 이미지 자체는 커밋하지 않습니다.

```sh
npm run fixtures:camera
npm run test:camera
```

참고: [wasm-vips](https://github.com/kleisauke/wasm-vips), [libvips ICC 처리](https://www.libvips.org/API/current/method.Image.icc_import.html), [CR3 구조](https://github.com/lclevy/canon_cr3), [CC0 Adobe-compatible ICC](https://github.com/saucecontrol/Compact-ICC-Profiles). 공급 라이브러리 라이선스는 생성된 엔진 폴더의 THIRD-PARTY-NOTICES와 `public/profiles/LICENSE.txt`에 포함됩니다.

### 배포 주소 검사 / WebKit 검사

`PLAYWRIGHT_BASE_URL`을 지정하면 로컬 서버 대신 해당 배포를 검사합니다.
`PLAYWRIGHT_BROWSER=webkit`으로 WebKit을 선택할 수 있습니다(`npx playwright install webkit` 필요).
Windows WebKit은 실제 iPhone Safari와 다르므로 실기기 검증은 별도입니다.
Worker 재생성 시 일부 WebKit의 캐시 응답 격리 정책 오류를 피하기 위해 JS 자산은 `no-store`를 사용합니다. 대형 WASM 바이너리에는 이 예외를 적용하지 않습니다.
