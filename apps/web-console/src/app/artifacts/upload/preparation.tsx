'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { ArtifactReceiptQuery, Classification } from '@planemem/contracts';
import { Badge } from '../../../components/ui';
import { readArtifactTransferBytes } from '../../../lib/artifact-transfer';
import { WEB_ARTIFACT_UPLOAD_BYTES } from '../../../lib/artifact-upload';
import { artifactPageHref } from '../query';
import {
  buildNewArtifactRequest,
  newArtifactUploadHref,
  parseArtifactUploadPreparation,
  type ArtifactUploadPreparation,
} from './preparation-model';

interface SourceDraft {
  key: number;
  type: string;
  id: string;
  revision: string;
  uri: string;
}
export interface PreparedArtifactContent {
  blob: Blob;
  name: string;
}

export function ArtifactRequestPreparation({
  preparation,
  onPrepare,
}: {
  preparation: ArtifactUploadPreparation;
  onPrepare: (request: ArtifactReceiptQuery, content: PreparedArtifactContent) => void;
}) {
  const [fixed] = useState(() =>
    parseArtifactUploadPreparation(preparation, preparation.target?.data.artifact.artifact_id),
  );
  const [name, setName] = useState('');
  const [mime, setMime] = useState('application/octet-stream');
  const [classification, setClassification] = useState<Classification>('internal');
  const [sources, setSources] = useState<SourceDraft[]>([]);
  const [content, setContent] = useState<PreparedArtifactContent & { sha256: string }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const operation = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const nextSource = useRef(1);
  const preparing = useRef(false);
  const target = fixed.target?.data.artifact;
  const identity = fixed.context.data.identity;
  const maximum = Math.min(WEB_ARTIFACT_UPLOAD_BYTES, fixed.context.data.max_bytes);

  useEffect(() => {
    mounted.current = true;
    const leave = () => {
      operation.current?.abort();
      setContent(undefined);
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) leave();
    };
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', restore);
    return () => {
      mounted.current = false;
      operation.current?.abort();
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('pageshow', restore);
    };
  }, []);

  async function choose(file: File | undefined) {
    if (!file || operation.current || preparing.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setContent(undefined);
    setMessage('');
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      if (Date.parse(fixed.context.data.expires_at) <= Date.now())
        throw new TypeError('This preparation has expired. Open a new preparation.');
      if (file.size > maximum)
        throw new TypeError('The selected file exceeds this preparation’s size limit.');
      if (typeof globalThis.crypto?.subtle?.digest !== 'function')
        throw new TypeError(
          'This browser cannot verify files. Reopen the workbench over HTTPS or use another upload client.',
        );
      const bytes = await readArtifactTransferBytes(
        file.stream(),
        maximum,
        controller.signal,
        file.size,
      );
      if (controller.signal.aborted) throw new Error('File preparation stopped.');
      const digest = new Uint8Array(
        await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer),
      );
      if (!mounted.current || operation.current !== controller) return;
      if (controller.signal.aborted) throw new Error('File preparation stopped.');
      if (Date.parse(fixed.context.data.expires_at) <= Date.now())
        throw new TypeError('This preparation has expired. Open a new preparation.');
      const sha256 = Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
      setContent({
        blob: new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' }),
        name: file.name,
        sha256,
      });
      if (!target) {
        setName((value) => value || file.name);
        if (file.type && /^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(file.type))
          setMime((value) => (value === 'application/octet-stream' ? file.type : value));
      }
      setMessage(
        'File read and hashed locally. Review the details, then prepare the original request. Nothing has been uploaded.',
      );
    } catch (error) {
      if (mounted.current && operation.current === controller)
        setMessage(
          controller.signal.aborted
            ? 'File preparation stopped. Select the file again to continue.'
            : error instanceof TypeError
              ? error.message
              : 'The file could not be read. Select it again to continue.',
        );
    } finally {
      clearTimeout(timer);
      if (mounted.current && operation.current === controller) setBusy(false);
      if (operation.current === controller) operation.current = null;
    }
  }

  function updateSource(key: number, field: Exclude<keyof SourceDraft, 'key'>, value: string) {
    setSources((entries) =>
      entries.map((entry) => (entry.key === key ? { ...entry, [field]: value } : entry)),
    );
  }
  function prepare() {
    if (!content || operation.current || preparing.current) return;
    preparing.current = true;
    try {
      if (typeof globalThis.crypto?.randomUUID !== 'function')
        throw new TypeError('A secure request key cannot be prepared in this browser.');
      const details = target
        ? {}
        : {
            name,
            mime,
            classification,
            source_refs: sources.map((source) => {
              if (source.revision !== '' && !/^(0|[1-9][0-9]*)$/.test(source.revision))
                throw new TypeError(
                  'Source revisions must be non-negative whole numbers without leading zeros.',
                );
              return {
                type: source.type,
                id: source.id,
                ...(source.revision === '' ? {} : { revision: Number(source.revision) }),
                ...(source.uri === '' ? {} : { uri: source.uri }),
              };
            }),
          };
      const descriptor = { size: content.blob.size, sha256: content.sha256 };
      // Validate all fields before allocating the one real key. No key is created during rendering.
      buildNewArtifactRequest(fixed, details, descriptor, 'preparation-only');
      const request = buildNewArtifactRequest(
        fixed,
        details,
        descriptor,
        'artifact_web_' + crypto.randomUUID(),
      );
      onPrepare(request, { blob: content.blob, name: content.name });
      setContent(undefined);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'The request could not be prepared. Review the fields.',
      );
      preparing.current = false;
    }
  }

  return (
    <form
      className="handoff-form checkpoint-form"
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        prepare();
      }}
    >
      <p>
        This preparation uses the verified account and project below. Preparing does not upload
        content or reserve a version.
      </p>
      <dl className="detail-grid checkpoint-detail-meta">
        <div>
          <dt>Account</dt>
          <dd>{identity.actor_id}</dd>
        </div>
        <div>
          <dt>Client</dt>
          <dd>{identity.client_id}</dd>
        </div>
        <div>
          <dt>Tenant</dt>
          <dd>{identity.tenant_id}</dd>
        </div>
        <div>
          <dt>Workspace</dt>
          <dd>{identity.workspace_id}</dd>
        </div>
        <div>
          <dt>Project</dt>
          <dd>{identity.project_id}</dd>
        </div>
        <div>
          <dt>Preparation expires</dt>
          <dd>
            <time dateTime={fixed.context.data.expires_at}>{fixed.context.data.expires_at}</time>
          </dd>
        </div>
      </dl>
      {target && (
        <div className="artifact-details">
          <h3>Add a version to {target.name}</h3>
          <p>
            <Badge>Current version read: {target.version}</Badge>{' '}
            <Badge>{target.classification}</Badge>
          </p>
          <p>
            The request will use version {target.version} as its original condition. Another writer
            may change the record after this read. Name, file type, classification and sources
            remain those of the file.
          </p>
          <p>
            File ID: <code>{target.artifact_id}</code> · Type: {target.mime}
          </p>
          <Link
            className="panel-link"
            href={artifactPageHref(target.artifact_id, target.version)}
            prefetch={false}
            target="_blank"
            rel="noreferrer"
          >
            Review the selected version in a new tab ↗
          </Link>
        </div>
      )}
      <label htmlFor="artifact-new-content">
        Choose content (up to {maximum.toLocaleString('en-US')} bytes)
      </label>
      <input
        id="artifact-new-content"
        type="file"
        disabled={busy}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          void choose(file);
        }}
      />
      {content && (
        <div>
          <p>
            <Badge tone="green">Content prepared locally</Badge> {content.name} ·{' '}
            {content.blob.size.toLocaleString('en-US')} bytes
          </p>
          <details>
            <summary>Content SHA-256</summary>
            <code className="context-hash">{content.sha256}</code>
          </details>
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => setContent(undefined)}
          >
            Release selected content
          </button>
        </div>
      )}
      {!target && (
        <>
          <div className="context-item-fields">
            <label>
              Recorded file name
              <input
                required
                maxLength={255}
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              File type (MIME)
              <input
                required
                maxLength={255}
                value={mime}
                disabled={busy}
                onChange={(event) => setMime(event.target.value)}
                placeholder="application/octet-stream"
              />
            </label>
            <label>
              Classification
              <select
                value={classification}
                disabled={busy}
                onChange={(event) => setClassification(event.target.value as Classification)}
              >
                <option value="public">Public</option>
                <option value="internal">Internal</option>
                <option value="confidential">Confidential</option>
                <option value="restricted" disabled={!fixed.context.data.can_read_restricted}>
                  Restricted
                </option>
              </select>
            </label>
          </div>
          <h3>Supporting sources (optional)</h3>
          <p className="muted">
            Record references you reviewed. This preparation does not open their contents or confirm
            that they are currently available.
          </p>
          {sources.map((source, index) => (
            <fieldset className="proposal-source-fields" key={source.key} disabled={busy}>
              <legend>Source {index + 1}</legend>
              <div className="context-item-fields">
                <label>
                  Type
                  <input
                    required
                    maxLength={128}
                    value={source.type}
                    onChange={(event) => updateSource(source.key, 'type', event.target.value)}
                  />
                </label>
                <label>
                  Identifier
                  <input
                    required
                    maxLength={1024}
                    value={source.id}
                    onChange={(event) => updateSource(source.key, 'id', event.target.value)}
                  />
                </label>
                <label>
                  Revision (optional)
                  <input
                    inputMode="numeric"
                    maxLength={16}
                    value={source.revision}
                    onChange={(event) => updateSource(source.key, 'revision', event.target.value)}
                  />
                </label>
              </div>
              <label>
                URI (optional)
                <input
                  maxLength={4096}
                  value={source.uri}
                  onChange={(event) => updateSource(source.key, 'uri', event.target.value)}
                />
              </label>
              <button
                className="secondary-button"
                type="button"
                onClick={() =>
                  setSources((values) => values.filter((entry) => entry.key !== source.key))
                }
              >
                Remove source {index + 1}
              </button>
            </fieldset>
          ))}
          <button
            className="secondary-button"
            type="button"
            disabled={busy || sources.length >= 200}
            onClick={() => {
              const key = nextSource.current++;
              setSources((values) => [
                ...values,
                { key, type: 'document', id: '', revision: '', uri: '' },
              ]);
            }}
          >
            Add source
          </button>
        </>
      )}
      <p className="muted">
        Prepare once after reviewing the fields. The resulting original request will be fixed for
        saving, submission and receipt lookup; editing it later means preparing a separate new
        request.
      </p>
      <div className="artifact-download-actions">
        <button className="primary-button" type="submit" disabled={busy || !content}>
          Prepare original request
        </button>
        {busy && (
          <button
            className="secondary-button"
            type="button"
            onClick={() => operation.current?.abort()}
          >
            Stop file preparation
          </button>
        )}
        <Link
          className="panel-link"
          href={newArtifactUploadHref(target?.artifact_id)}
          prefetch={false}
          target="_blank"
          rel="noreferrer"
        >
          Read a fresh preparation in a new tab ↗
        </Link>
      </div>
      {busy && <p role="status">Reading and hashing the selected content…</p>}
      {message && <p role="status">{message}</p>}
    </form>
  );
}
