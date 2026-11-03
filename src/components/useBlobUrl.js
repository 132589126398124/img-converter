import { useEffect, useState } from 'react';
export function useBlobUrl(blob) {
  const [entry, setEntry] = useState(null);
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    // This effect owns an external Blob URL and must release it on every replacement/unmount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntry({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return entry && entry.blob === blob ? entry.url : null;
}
