'use client';

import { useEffect, useRef, useState } from 'react';
import type { ArtifactReceiptEnvelope } from '@planemem/contracts';
import { inspectSavedArtifactReceipt } from './saved-model';

export function ArtifactReceiptFileActions({
  receipt,
  includeOriginal = false,
}: {
  receipt: ArtifactReceiptEnvelope;
  includeOriginal?: boolean;
}) {
  const [message, setMessage] = useState('');
  const urls = useRef(new Set<string>());
  useEffect(() => {
    const release = () => {
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current.clear();
    };
    window.addEventListener('pagehide', release);
    return () => {
      release();
      window.removeEventListener('pagehide', release);
    };
  }, []);
  useEffect(() => {
    setMessage('');
  }, [receipt]);

  function save(original: boolean) {
    let url: string | undefined;
    try {
      const selected = inspectSavedArtifactReceipt(receipt);
      const raw = original ? selected.original_json : selected.receipt_json;
      url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
      urls.current.add(url);
      const link = document.createElement('a');
      link.href = url;
      link.download = original ? 'artifact-original-request.json' : 'artifact-receipt.json';
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
      }
      setMessage(
        'Save requested. Check your browser downloads to confirm where the file was saved.',
      );
    } catch {
      setMessage(
        'The file could not be prepared for saving. Keep the receipt and original request; no upload or receipt query was sent.',
      );
    } finally {
      if (url) {
        const selected = url;
        setTimeout(() => {
          URL.revokeObjectURL(selected);
          urls.current.delete(selected);
        }, 1000);
      }
    }
  }
  return (
    <div>
      <div className="heading-actions artifact-receipt-actions">
        <button className="secondary-button" type="button" onClick={() => save(false)}>
          Save receipt JSON
        </button>
        {includeOriginal && (
          <button className="secondary-button" type="button" onClick={() => save(true)}>
            Save request from this receipt
          </button>
        )}
      </div>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
