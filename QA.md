# Lumina Flow 검증 기록

검증일: 2026-11-03 (Asia/Seoul). Windows, Node.js 24, 로컬 설치 Chrome, libvips 8.18.7 / wasm-vips 0.0.19.

## 완료한 검사

| 검사                          | 결과와 범위                                                                                                                                                                                                                                                |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 린트·TypeScript·프로덕션 빌드 | 통과. 동일 출처 WASM 배포 파일과 COOP/COEP 적용                                                                                                                                                                                                            |
| 단위·이미지 엔진 회귀         | 17개 통과. 실제 WASM 코덱으로 JPG/WebP/PNG/AVIF 재디코딩·ICC·메타데이터 확인                                                                                                                                                                               |
| 네이티브 색상 비교            | 16비트 Adobe RGB 그라데이션 → sRGB / Display P3 / 원본 ICC PNG. native libvips(sharp)와 비교. 8비트 sRGB로 정규화한 비교에서 평균 절대 채널 차이 0.162 / 0.160 / 0.263, 최대 4 / 4 / 9. 이 합성 이미지 범위의 결과이며 모든 사진의 색상 동일성 보장은 아님 |
| 실제 R6 Mark III 카메라 파일  | CC0 공개 RAW·C-RAW 풀프레임/크롭 4개, SHA256 확인. 내장 JPEG 6960×4640 / 4320×2880 추출, 장축 2048 출력, 렌즈·노출·촬영일·원래 시간대(-08:00) 보존 확인                                                                                                    |
| 프로덕션 브라우저 회귀        | Chrome 7개 통과. 실제 Worker/WASM, JPG/WebP/PNG/AVIF 결과 다운로드, ZIP 재열기, 픽셀 비교, 복원, CR3, 저장 공간 부족 처리                                                                                                                                       |
| PC 100장                      | 640×480 합성 JPG 100장. 중간 일시정지·취소·재개 후 100장 완료. 완료 파일 재요청 없음, 새로고침 후 결과 복원                                                                                                                                                |
| 모바일 화면 20장              | Chrome 393×852 터치 에뮬레이션. 640×480 합성 사진 20장 → 각 2분할, 192×240 결과. 설정 시트, 연결 미리보기, 결과·다크 테마, 가로 넘침 없음 확인                                                                                                             |
| 실제 32MP CR3 브라우저 처리   | R6 Mark III 풀프레임 공개 RAW 샘플을 Chrome Worker에서 읽고 장축 2048 JPG로 변환·검증                                                                                                                                                                      |
| 저장 공간 실패                | IndexedDB QuotaExceededError 주입. 첫 결과 다운로드 가능, 다음 작업 정지, 불완전 결과 레코드는 커밋하지 않음                                                                                                                                               |
| 원본 무수정                   | 모든 입력은 읽기 전용 File/버퍼로 사용. 출력은 별도 Blob/IndexedDB 레코드. 원본 경로에 쓰는 코드 없음                                                                                                                                                      |

## 회귀로 고정한 문제

- 품질 100·동일 포맷에서도 촬영정보 제거가 우회되지 않음. JPEG 스캔 데이터는 재압축하지 않음.
- JPEG 스캔 뒤 주석·종료 뒤 추가 데이터, EXIF/XMP/IPTC/GPS 제거를 검증.
- 용량 제한은 ICC·EXIF 포함 최종 파일 기준. 불가능한 제한은 목표 미달이며 해상도는 유지.
- 실제 시그니처·MIME·확장자 일치. 브라우저 Canvas 인코더의 포맷 대체 동작에 의존하지 않음.
- 방향 태그 정규화, 투명 PNG → 흰 배경 JPG, WebP 투명도, 16비트 회색 TIFF, 손상 ICC와 명시적 입력 지정.
- CR3의 PRVW보다 큰 JPEG 트랙을 선택. 경계 밖 컨테이너 오프셋·없는 DNG 미리보기를 거부.
- ZIP 파일명 충돌 방지와 64MiB 묶음 규칙.

## 재현 명령

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run fixtures:camera
npm run test:camera
npm run test:browser
```

카메라 샘플 목록·공개 URL·해시는 `tests/camera-fixtures.json`에 있습니다. 외부 샘플은 opt-in 다운로드이며 기본 테스트나 서비스에서 자동 다운로드하지 않습니다. CI는 카메라 샘플이 없으면 선택적 실제 카메라 브라우저 검사 1개를 건너뛰고 합성 컨테이너 검사를 실행합니다.

브라우저 스크린샷은 `test-results/desktop-verified.png`, `desktop-batch-100.png`, `mobile-results.png`, `mobile-settings.png`, `mobile-dark.png`, `real-r6-iii.png`에 생성됩니다.

## 실제 기기에서 남은 검증

- **실제 iPhone Safari·Chrome 및 Android Chrome의 20장 연속 처리와 메모리·저장·공유 검증.** Chrome 에뮬레이션은 이 검증을 대신하지 않습니다.
- 실제 고해상도 스캔 TIFF·사용자 보정본과 여러 조명/방향/펌웨어의 사용자 R6 Mark III 사진 검증. 현재 카메라 샘플 4개는 공개된 특정 촬영 조건입니다.
- HEIC 실제 기기 디코딩·방향·저장 검증. 보조 HEIC 경로는 8비트이며 고비트·원본 ICC·HDR 보존을 보장하지 않습니다.
- Vercel 배포의 문서/Worker/WASM 응답 헤더와 실제 변환은 배포 후 별도 기록합니다. iOS 파일 선택·공유·다운로드는 실기기 검증 대상입니다.
- 사용자의 Git 자동 배포 요청에 따라 게시하되, 위 실기기 항목을 통과했다고 간주하지 않습니다. 정밀 RAW 현상, HDR 톤 매핑과 16비트 결과 출력은 이번 버전 범위가 아닙니다.

## UI 및 WebKit 추가 검사

- 읽기 가능한 최소 본문/보조 글자 크기, 파란색 주요 행동, 목적별 설명, 선택 버튼의 `aria-pressed`, 44px 기본 터치 영역, PC 패널 독립 스크롤과 고정 실행 바를 적용했습니다.
- Windows Playwright WebKit 27.2: 변환·다운로드·ZIP·새로고침 복원 및 모바일 화면 20장 시나리오 2개 통과. 실기기 Safari 합격을 의미하지 않습니다.
- 재현한 WebKit Worker 캐시 보안 정책 오류: 동일 출처 CORP 및 JS `no-store` 응답 적용 후 통과. [유사한 WebKit 캐시 정책 이슈](https://bugs.webkit.org/show_bug.cgi?id=245346)는 참고 자료이며, 현재 재현과 동일한 결함이라고 단정하지 않습니다.
- 재현한 Windows WebKit IndexedDB 오류: 5바이트 Blob 저장은 UnknownError, 문자열/ArrayBuffer 저장은 성공. 완료 파일과 썸네일을 바이트 레코드로 기록해 복원을 검증했습니다. 기존 Blob 레코드 읽기도 유지합니다.
- 저장 실패 원인은 QuotaExceededError와 그 밖의 저장 오류를 구분해 표시합니다.
