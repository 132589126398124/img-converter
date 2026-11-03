import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import sharp from 'sharp';
import JSZip from 'jszip';
import { photo, cr3Fixture } from './fixtures.mjs';

test('desktop: local Worker, privacy, exact-pixel proof, download, ZIP and reload recovery', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: '첫 사진 추가하기' }),
  ).toBeEnabled();
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  const input = await photo(1200, 800, 'p3');
  await page.locator('#file-input').setInputFiles({
    name: 'editorial.jpg',
    mimeType: 'image/jpeg',
    buffer: input,
  });
  await expect(page.locator('.status-ready')).toHaveCount(1);
  await page.getByRole('button', { name: '제거', exact: true }).click();
  await page.locator('summary').click();
  await page.getByLabel('출력 포맷', { exact: true }).selectOption('webp');
  await page.getByRole('button', { name: '이 사진 먼저 변환·검증' }).click();
  await expect(page.locator('.status-done')).toHaveCount(1);
  await expect(page.locator('.output-report')).toContainText('촬영정보 제거됨');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '1번 결과 저장' }).click();
  const file = await download,
    output = await readFile(await file.path());
  expect(file.suggestedFilename()).toBe('editorial.webp');
  const metadata = await sharp(output).metadata();
  expect(metadata.format).toBe('webp');
  expect(metadata.icc).toBeTruthy();
  expect(metadata.exif).toBeUndefined();
  await page.getByRole('button', { name: '100% 인코딩 검사' }).click();
  await expect(page.locator('.proof-panes img')).toHaveCount(2, {
    timeout: 60000,
  });
  await expect(page.locator('.proof-caption')).toContainText('768 × 768px');
  await page.getByRole('button', { name: '비교 닫기' }).click();
  await page.screenshot({
    path: 'test-results/desktop-verified.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: '전체 ZIP', exact: true }).click();
  await expect(page.getByText('ZIP 파일이 준비되었습니다')).toBeVisible();
  const zipDownload = page.waitForEvent('download');
  await page.locator('.archive-tray a').click();
  const zip = await JSZip.loadAsync(
    await readFile(await (await zipDownload).path()),
  );
  expect(Object.keys(zip.files)).toEqual(['editorial.webp']);
  await page.reload();
  await expect(page.locator('.status-done')).toHaveCount(1);
  await expect(page.locator('.output-report')).toContainText('촬영정보 제거됨');
  await expect(
    page.getByRole('button', { name: '이 사진 다시 처리' }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});

test('desktop: 100 pictures, immutable settings, pause and cancellation preserve completed results without duplicate completed requests', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__runFiles = [];
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...rest) {
      if (message?.method === 'run') window.__runFiles.push(message.file.name);
      return original.call(this, message, ...rest);
    };
  });
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: '첫 사진 추가하기' }),
  ).toBeEnabled();
  const buffer = await photo(640, 480);
  await page.locator('#file-input').setInputFiles(
    Array.from({ length: 100 }, (_, i) => ({
      name: `batch_${String(i).padStart(3, '0')}.jpg`,
      mimeType: 'image/jpeg',
      buffer,
    })),
  );
  await expect(page.locator('.status-ready')).toHaveCount(100, {
    timeout: 120000,
  });
  await page.getByRole('button', { name: '100장 변환하기' }).click();
  await expect
    .poll(() => page.locator('.status-done').count())
    .toBeGreaterThan(0);
  await expect(page.getByLabel('장축 직접 지정')).toBeDisabled();
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  await expect(page.getByRole('button', { name: '이어서 처리' })).toBeEnabled({
    timeout: 60000,
  });
  const completed = await page
    .locator('.photo-item:has(.status-done) .photo-label strong')
    .allTextContents();
  await page.getByRole('button', { name: '이어서 처리' }).click();
  await expect(
    page.getByRole('button', { name: '취소', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.getByRole('button', { name: '이어서 처리' })).toBeEnabled({
    timeout: 60000,
  });
  for (const name of completed)
    expect(
      await page.evaluate(
        (n) => window.__runFiles.filter((x) => x === n).length,
        name,
      ),
    ).toBe(1);
  await page.getByRole('button', { name: '이어서 처리' }).click();
  await expect(page.locator('.status-done')).toHaveCount(100, {
    timeout: 120000,
  });
  for (const name of completed)
    expect(
      await page.evaluate(
        (n) => window.__runFiles.filter((x) => x === n).length,
        name,
      ),
    ).toBe(1);
  await page.reload();
  await expect(page.locator('.status-done')).toHaveCount(100);
  await page.screenshot({
    path: 'test-results/desktop-batch-100.png',
    fullPage: true,
  });
});

test.describe('mobile viewport (emulation, not a physical device)', () => {
  test.use({
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
  });
  test('20 pictures, settings sheet, panorama previews and stored results fit the viewport', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(
      page.getByRole('button', { name: '사진 추가', exact: true }),
    ).toBeEnabled();
    const buffer = await photo(640, 480);
    await page.locator('#file-input').setInputFiles(
      Array.from({ length: 20 }, (_, i) => ({
        name: `mobile_${i}.jpg`,
        mimeType: 'image/jpeg',
        buffer,
      })),
    );
    await expect(page.locator('.status-ready')).toHaveCount(20, {
      timeout: 90000,
    });
    await page.getByRole('button', { name: '02 설정·미리보기' }).click();
    await page.getByRole('button', { name: '설정', exact: true }).click();
    await page
      .locator('.inspector .purpose-buttons')
      .getByRole('button', { name: 'SNS 프레임' })
      .click();
    await page.getByLabel('파노라마 분할').selectOption('2');
    await page.getByLabel('장축 직접 지정').fill('240');
    await page.getByRole('button', { name: '제거', exact: true }).click();
    await page.screenshot({
      path: 'test-results/mobile-settings.png',
      fullPage: true,
    });
    await page.getByRole('button', { name: '설정 적용 · 미리보기' }).click();
    await expect(page.locator('.slice-nav')).toContainText('왼쪽부터');
    await page.getByRole('button', { name: '20장 변환하기' }).click();
    await expect(page.locator('.status-done')).toHaveCount(20, {
      timeout: 120000,
    });
    await expect(page.locator('.artifact-row')).toHaveCount(2);
    await expect(page.locator('.artifact-row').first()).toContainText(
      '192 × 240',
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: 'test-results/mobile-results.png',
      fullPage: true,
    });
    await page.getByRole('button', { name: '테마 변경' }).click();
    await page.screenshot({
      path: 'test-results/mobile-dark.png',
      fullPage: true,
    });
  });
});

test('CR3 browser path extracts the largest embedded JPEG and makes its provenance explicit', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: '첫 사진 추가하기' }),
  ).toBeEnabled();
  const buffer = Buffer.from(
    cr3Fixture(await photo(800, 600), await photo(160, 120)),
  );
  await page.locator('#file-input').setInputFiles({
    name: 'R6_III_fixture.CR3',
    mimeType: 'application/octet-stream',
    buffer,
  });
  await expect(page.locator('.status-ready')).toHaveCount(1);
  await expect(page.locator('.source-label')).toContainText(
    'RAW 내장 JPEG 기반',
  );
  await expect(page.locator('.photo-label')).toContainText('800 × 600');
  await page.getByRole('button', { name: '이 사진 먼저 변환·검증' }).click();
  await expect(page.locator('.status-done')).toHaveCount(1);
});

test('real R6 Mark III 32MP RAW loads and converts inside the browser Worker', async ({
  page,
}) => {
  test.skip(
    !existsSync('tests/fixtures/external/r6-iii-raw.CR3'),
    'Run npm run fixtures:camera to download the CC0 camera samples.',
  );
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: '첫 사진 추가하기' }),
  ).toBeEnabled();
  await page
    .locator('#file-input')
    .setInputFiles('tests/fixtures/external/r6-iii-raw.CR3');
  await expect(page.locator('.status-ready')).toHaveCount(1, {
    timeout: 60000,
  });
  await expect(page.locator('.photo-label')).toContainText('6960 × 4640');
  await page.getByLabel('장축 길이 프리셋').selectOption('2048');
  await page.getByRole('button', { name: '이 사진 먼저 변환·검증' }).click();
  await expect(page.locator('.status-done')).toHaveCount(1, { timeout: 60000 });
  await expect(page.locator('.output-report')).toContainText('촬영정보 확인됨');
  await page.screenshot({
    path: 'test-results/real-r6-iii.png',
    fullPage: true,
  });
});

test('storage quota stops the queue, keeps current output downloadable and avoids partial durable records', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__quota = false;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'artifacts' && window.__quota)
        throw new DOMException('Test quota full', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: '첫 사진 추가하기' }),
  ).toBeEnabled();
  const buffer = await photo();
  await page.locator('#file-input').setInputFiles([
    { name: 'quota1.jpg', mimeType: 'image/jpeg', buffer },
    { name: 'quota2.jpg', mimeType: 'image/jpeg', buffer },
  ]);
  await expect(page.locator('.status-ready')).toHaveCount(2);
  await page.evaluate(() => {
    window.__quota = true;
  });
  await page.getByRole('button', { name: '2장 변환하기' }).click();
  await expect(
    page.getByText('저장 공간이 부족해 다음 작업을 멈췄습니다.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.locator('.status-done')).toHaveCount(1);
  await expect(page.locator('.status-ready')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '1번 결과 저장' }).click();
  expect((await download).suggestedFilename()).toBe('quota1.jpg');
  await page.reload();
  await expect(page.locator('.status-missing')).toHaveCount(2);
  await expect(page.locator('.output-report')).toHaveCount(0);
});

test('browser PNG and AVIF encoders preserve ICC and do not fall back to a different MIME type', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: '첫 사진 추가하기' }),
  ).toBeEnabled();
  await page.locator('#file-input').setInputFiles({
    name: 'codecs.png',
    mimeType: 'image/png',
    buffer: await sharp(await photo(160, 120))
      .withIccProfile('srgb')
      .png()
      .toBuffer(),
  });
  await expect(page.locator('.status-ready')).toHaveCount(1);
  await page.getByRole('button', { name: '제거', exact: true }).click();
  await page.locator('summary').click();
  for (const format of ['png', 'avif']) {
    await page.getByLabel('출력 포맷', { exact: true }).selectOption(format);
    await page
      .getByRole('button', {
        name: format === 'png' ? '이 사진 먼저 변환·검증' : '이 사진 다시 처리',
      })
      .click();
    await expect(page.locator('.status-done')).toHaveCount(1);
    await expect(page.locator('.artifact-row strong')).toContainText(
      format.toUpperCase(),
    );
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '1번 결과 저장' }).click();
    const file = await download,
      metadata = await sharp(await readFile(await file.path())).metadata();
    expect(metadata.icc).toBeTruthy();
    expect(metadata.exif).toBeUndefined();
    expect(file.suggestedFilename()).toBe(`codecs.${format}`);
  }
});
