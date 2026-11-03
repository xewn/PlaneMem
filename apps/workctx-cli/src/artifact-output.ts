import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { link, lstat, open, realpath, stat, unlink, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { ContractError, createUlid } from '@planemem/contracts';

export interface ArtifactOutput {
  path: string;
  directory: string;
}

/** Resolve the caller's directory once; remote names never select local paths. */
export async function prepareArtifactOutput(value: string, trace: string): Promise<ArtifactOutput> {
  try {
    if (!value.trim() || value === '-' || /[\u0000-\u001f]/.test(value)) throw new TypeError();
    const path = resolve(value);
    const name = basename(path);
    if (!name || /[\\/]$/.test(value) || value === '.' || value === '..') throw new TypeError();
    if (
      process.platform === 'win32' &&
      (/[<>:"|?*]/.test(name) ||
        /[. ]$/.test(name) ||
        /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name))
    )
      throw new TypeError();
    const directory = await realpath(dirname(path));
    if (!(await stat(directory)).isDirectory()) throw new TypeError();
    const target = join(directory, name);
    try {
      await lstat(target);
      throw new TypeError('Output exists');
    } catch (error) {
      if (code(error) !== 'ENOENT') throw error;
    }
    return { path: target, directory };
  } catch {
    throw new ContractError(
      'ARTIFACT_OUTPUT_UNAVAILABLE',
      'Choose a new output file in an existing directory; existing files and links are never replaced',
      { trace_id: trace, dispatch_state: 'not-sent' },
    );
  }
}

function code(error: unknown): unknown {
  return error && typeof error === 'object' && 'code' in error ? error.code : undefined;
}

async function owned(path: string, identity: BigIntStats): Promise<boolean> {
  try {
    const current = await lstat(path, { bigint: true });
    return current.isFile() && current.dev === identity.dev && current.ino === identity.ino;
  } catch {
    return false;
  }
}

/** No replacement fallback: publication requires the filesystem's exclusive hard-link operation. */
export async function saveArtifactOutput(
  output: ArtifactOutput,
  content: Uint8Array,
  sha256: string,
  trace: string,
) {
  const target = { ...output };
  const temporary = join(target.directory, '.workctx-artifact-' + createUlid() + '.part');
  let handle: FileHandle | undefined;
  let identity: BigIntStats | undefined;
  let created = false;
  let verified = false;
  let published = false;
  let phase = 'verify-content';
  let failure: unknown;
  try {
    if (createHash('sha256').update(content).digest('hex') !== sha256) throw new TypeError();
    phase = 'create-temporary';
    handle = await open(temporary, 'wx+', 0o600);
    created = true;
    identity = await handle.stat({ bigint: true });
    if (!identity.isFile()) throw new TypeError();
    phase = 'write';
    let offset = 0;
    while (offset < content.byteLength) {
      const { bytesWritten } = await handle.write(
        content,
        offset,
        Math.min(64 * 1024, content.byteLength - offset),
        offset,
      );
      if (bytesWritten === 0) throw new TypeError();
      offset += bytesWritten;
    }
    phase = 'sync';
    await handle.sync();
    phase = 'readback';
    const hash = createHash('sha256');
    const buffer = new Uint8Array(64 * 1024);
    offset = 0;
    while (offset < content.byteLength) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.byteLength, content.byteLength - offset),
        offset,
      );
      if (bytesRead === 0) throw new TypeError();
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    if ((await handle.stat()).size !== content.byteLength || hash.digest('hex') !== sha256)
      throw new TypeError();
    verified = true;
    phase = 'close';
    await handle.close();
    handle = undefined;
    if (!(await owned(temporary, identity))) throw new TypeError();
    phase = 'publish';
    await link(temporary, target.path);
    published = true;
  } catch (error) {
    failure = error;
  }
  // Cleanup never follows an unowned path or removes the user's destination.
  try {
    await handle?.close();
  } catch {
    /* Report retained temporary state below. */
  }
  let cleanupPending = created;
  if (identity && (await owned(temporary, identity))) {
    try {
      await unlink(temporary);
      cleanupPending = false;
    } catch {
      /* Keep recovery path. */
    }
  }
  if (!published) {
    throw new ContractError(
      'ARTIFACT_SAVE_FAILED',
      code(failure) === 'EEXIST' && phase === 'publish'
        ? 'Output already exists; downloaded content was not published'
        : phase === 'publish'
          ? 'Could not publish verified content; the output filesystem must support hard links'
          : 'Could not complete local file preparation; downloaded content was not published',
      {
        trace_id: trace,
        details: {
          local_state: 'not-saved',
          save_phase: phase,
          output_path: target.path,
          ...(cleanupPending
            ? {
                temporary_path: temporary,
                temporary_state: verified ? 'verified-before-publication' : 'unverified',
                cleanup_pending: true,
              }
            : {}),
        },
      },
    );
  }
  return {
    state: 'saved' as const,
    path: target.path,
    content_state: 'verified' as const,
    cleanup_pending: cleanupPending,
    ...(cleanupPending ? { temporary_path: temporary } : {}),
  };
}
