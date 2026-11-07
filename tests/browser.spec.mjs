import { test, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import sharp from 'sharp';
import JSZip from 'jszip';
import { photo, cr3Fixture } from './fixtures.mjs';
import { extractCr3 } from '../src/engine/rawPreview.js';

test('resource failure pauses the batch, keeps completed files and resumes on a fresh worker', async ({ page }) => {
  await page.addInitScript(() => {
    window.__runs = [];
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...rest) {
      if (message?.method === 'run') {
        window.__runs.push(message.file.name);
        if (window.__runs.length === 2) {
          setTimeout(() => this.dispatchEvent(new MessageEvent('message', {
            data: { id: message.id, fatal: true, error: 'vips_tracked: out of memory -- size == 98MB' },
          })), 0);
          return;
        }
      }
      return original.call(this, message, ...rest);
    };
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '첫 사진 추가하기' })).toBeEnabled();
  const buffer = await photo(640, 480);
  await page.locator('#file-input').setInputFiles([0, 1, 2].map(i => ({ name: `recovery-${i}.jpg`, mimeType: 'image/jpeg', buffer })));
  await expect(page.locator('.status-ready')).toHaveCount(3);
  await page.getByRole('button', { name: '3장 변환하기' }).click();
  await expect(page.getByRole('button', { name: '이어서 처리' })).toBeEnabled();
  await expect(page.locator('.status-done')).toHaveCount(1);
  await expect(page.locator('.status-error')).toHaveCount(1);
  await expect(page.locator('.status-ready')).toHaveCount(1);
  expect(await page.evaluate(() => window.__runs)).toEqual(['recovery-0.jpg', 'recovery-1.jpg']);
  await page.getByRole('button', { name: '이어서 처리' }).click();
  await expect(page.locator('.status-done')).toHaveCount(3);
  expect(await page.evaluate(() => window.__runs)).toEqual(['recovery-0.jpg', 'recovery-1.jpg', 'recovery-1.jpg', 'recovery-2.jpg']);
});

test('opt-in: 51 original 32MP JPEG files convert to WebP Q95 with bounded worker lifetime', async ({ page }) => {
  test.skip(!process.env.LUMINA_WEBP_STRESS, 'Opt-in high-resolution batch');
  test.setTimeout(1800000);
  const input = extractCr3(new Uint8Array(await readFile('tests/fixtures/external/r6-iii-raw.CR3'))).bytes;
  const directory = 'tests/fixtures/generated/webp-batch';
  await mkdir(directory, { recursive: true });
  const paths = [];
  for (let i = 0; i < 51; i++) {
    const path = `${directory}/photo-${i}.jpg`;
    await writeFile(path, input);
    paths.push(path);
  }
  await page.addInitScript(() => {
    window.__finalWorkers = [];
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...rest) {
      if (message?.method === 'run') window.__finalWorkers.push(this);
      return original.call(this, message, ...rest);
    };
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '첫 사진 추가하기' })).toBeEnabled();
  await page.locator('#file-input').setInputFiles(paths);
  await expect(page.locator('.status-ready')).toHaveCount(51, { timeout: 300000 });
  await page.getByLabel('출력 포맷', { exact: true }).selectOption('webp');
  await page.getByRole('button', { name: '51장 변환하기' }).click();
  let reported = -1;
  await expect.poll(async () => {
    const done = await page.locator('.status-done').count();
    if (done !== reported) {
      console.log(`32MP WebP batch: ${done}/51 done, ${await page.locator('.status-error').count()} failed`);
      reported = done;
    }
    return done;
  }, { timeout: 1500000, intervals: [2000] }).toBe(51);
  expect(await page.evaluate(() => new Set(window.__finalWorkers).size)).toBe(51);
  await expect(page.locator('.status-error')).toHaveCount(0);
  await expect(page.locator('.output-report')).toContainText('6960 × 4640');
  await expect(page.locator('.output-report')).toContainText('품질 95');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '1번 결과 저장' }).click();
  const metadata = await sharp(await readFile(await (await download).path())).metadata();
  expect(metadata.format).toBe('webp');
  expect(metadata.width).toBe(6960);
  expect(metadata.height).toBe(4640);
  await page.reload();
  await expect(page.locator('.status-done')).toHaveCount(51);
});

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
  await expect(page.getByLabel('장축 길이 프리셋')).toBeDisabled();
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
    await page
      .locator('.mobile-purpose .purpose-buttons')
      .getByRole('button', { name: 'SNS 프레임' })
      .click();
    await expect(page.getByRole('dialog', { name: '출력 설정' })).toBeVisible();
    await page.getByLabel('파노라마 분할').selectOption('2');
    await page.getByLabel('장축 길이 프리셋').selectOption('custom');
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

test('three real R6 Mark III 32MP RAW files convert at original resolution inside the browser Worker', async ({
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
  const buffer = await readFile('tests/fixtures/external/r6-iii-raw.CR3');
  for (let i = 0; i < 3; i++) {
    await page.locator('#file-input').setInputFiles({ name: `r6-${i}.CR3`, mimeType: 'image/x-canon-cr3', buffer });
    await expect(page.locator('.status-ready')).toHaveCount(i + 1, { timeout: 60000 });
  }
  await expect(page.locator('.photo-label').first()).toContainText('6960 × 4640');
  await page.getByRole('button', { name: '3장 변환하기' }).click();
  await expect(page.locator('.status-done')).toHaveCount(3, { timeout: 120000 });
  await expect(page.locator('.output-report')).toContainText('촬영정보 확인됨');
  await expect(page.locator('.output-report')).toContainText('6960');
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

test('desktop workflow: size target is immediately visible and clearing is atomic and confirmed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: '첫 사진 추가하기' }),
  ).toBeEnabled();
  const buffer = await photo(640, 480);
  await page.locator('#file-input').setInputFiles([
    { name: 'clear-one.jpg', mimeType: 'image/jpeg', buffer },
    { name: 'clear-two.jpg', mimeType: 'image/jpeg', buffer },
  ]);
  await expect(page.locator('.status-ready')).toHaveCount(2);
  await page
    .locator('.inspector')
    .getByRole('button', { name: '용량 맞추기', exact: true })
    .click();
  const target = page.getByLabel('최대 용량 MB');
  await expect(target).toBeVisible();
  const rect = await target.boundingBox();
  const footer = await page.locator('.batch-bar').boundingBox();
  expect(rect.y).toBeGreaterThan(0);
  expect(rect.y + rect.height).toBeLessThan(footer.y);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight + 1,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: '1 MiB', exact: true }).click();
  await expect(target).toHaveValue('1');
  await expect(page.getByLabel('출력 포맷', { exact: true })).toBeVisible();
  await expect(page.getByLabel('장축 직접 지정')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/desktop-workflow.png' });
  await page.getByRole('button', { name: '2장 변환하기' }).click();
  await expect(page.locator('.status-done')).toHaveCount(2);
  await expect(
    page.getByRole('button', { name: '이 사진 저장', exact: true }),
  ).toBeEnabled();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '전체 비우기', exact: true }).click();
  await expect(page.locator('.status-done')).toHaveCount(2);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '전체 비우기', exact: true }).click();
  await expect(page.locator('.photo-item')).toHaveCount(0);
  const counts = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('lumina-flow', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['tasks', 'artifacts']);
          const a = tx.objectStore('tasks').count();
          const b = tx.objectStore('artifacts').count();
          tx.oncomplete = () => {
            resolve([a.result, b.result]);
            db.close();
          };
        };
      }),
  );
  expect(counts).toEqual([0, 0]);
  await page.reload();
  await expect(
    page.getByRole('button', { name: '첫 사진 추가하기' }),
  ).toBeEnabled();
  await expect(page.locator('.photo-item')).toHaveCount(0);
});
