import JSZip from 'jszip';
self.onmessage = async ({ data }) => {
  try {
    const zip = new JSZip();
    // Encoded pictures are already compressed. STORE avoids wasting CPU and extra buffers.
    for (const item of data) zip.file(item.name, await item.blob.arrayBuffer());
    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'STORE' },
      ({ percent }) => self.postMessage({ progress: percent }),
    );
    self.postMessage({ blob });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
