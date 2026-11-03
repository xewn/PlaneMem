'use client';

import { backupHash, backupOperation } from '../sync/receipt/backup-operation';
import {
  inBrowserStores,
  readBrowserPair,
  type BrowserStoreLayout,
} from '../sync/receipt/browser-store';
import {
  assertProposalSubmissionBinding,
  parseProposalSubmissionBinding,
  type ProposalSubmissionBinding,
} from './original-model';

export const SAVED_COPY_SELECTION_LIMIT = 20;
export interface SavedCopy {
  binding: ProposalSubmissionBinding;
  request_key: string;
}
interface SelectionDocument<Draft> {
  binding: ProposalSubmissionBinding;
  entries: Draft[];
}
export interface ReviewedSavedSelection<Draft> {
  file: { document: SelectionDocument<Draft>; document_sha256: string };
  raw: string;
}

/** Keeps immutable stored-copy formats and exact pair validators in their own stores. */
export function createSavedCopyCleanup<
  Draft extends SavedCopy,
  Summary extends { request_key: string },
  Document extends SelectionDocument<Draft>,
>(config: {
  layout: BrowserStoreLayout;
  kind: string;
  documentBytes: number;
  fileBytes: number;
  key: (binding: ProposalSubmissionBinding, requestKey: string) => string;
  pair: (raw: unknown, index: unknown, binding: ProposalSubmissionBinding, slot: string) => Draft;
  encode: (draft: Draft) => string;
  summary: (draft: Draft) => Summary;
  readBudget: () => (raw: unknown, index: unknown) => void;
  parseDocument: (value: unknown) => Document;
  documentJson: (value: unknown) => string;
  parseFile: (value: unknown) => { document: Document; document_sha256: string };
  fileJson: (value: unknown) => string;
}) {
  function selectionSize(length: number) {
    if (length < 1 || length > SAVED_COPY_SELECTION_LIMIT) throw new TypeError();
  }
  function prepare(
    bindingInput: ProposalSubmissionBinding,
    selections: Summary[],
    signal: AbortSignal,
  ) {
    return backupOperation(
      signal,
      async (operationSignal, check): Promise<ReviewedSavedSelection<Draft>> => {
        check();
        const binding = parseProposalSubmissionBinding(bindingInput);
        selectionSize(selections.length);
        const slots = selections
          .map((entry) => ({
            slot: config.key(binding, entry.request_key),
            index: JSON.stringify(entry),
          }))
          .sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0));
        if (slots.some((entry, i) => i > 0 && entry.slot === slots[i - 1]!.slot))
          throw new TypeError();
        const document = await inBrowserStores<Document>(
          config.layout,
          'readonly',
          operationSignal,
          () => {
            throw new TypeError();
          },
          (context) => {
            const entries: Draft[] = [];
            const account = config.readBudget();
            const next = () => {
              check();
              const item = slots[entries.length];
              if (!item) {
                context.accept(
                  config.parseDocument({ schema_version: 1, kind: config.kind, binding, entries }),
                );
                return;
              }
              readBrowserPair(context, item.slot, (raw, index, exists) => {
                if (!exists || index !== item.index) throw new TypeError();
                account(raw, index);
                entries.push(config.pair(raw, index, binding, item.slot));
                next();
              });
            };
            next();
          },
        );
        check();
        const document_sha256 = await backupHash(config.documentJson(document));
        check();
        const file = config.parseFile({ document, document_sha256 });
        return { file, raw: config.fileJson(file) };
      },
    );
  }
  function remove(
    raw: string,
    binding: ProposalSubmissionBinding,
    digest: string,
    signal: AbortSignal,
  ) {
    return backupOperation(signal, async (operationSignal, check) => {
      check();
      if (
        !raw ||
        raw.length > config.fileBytes ||
        new TextEncoder().encode(raw).byteLength > config.fileBytes
      )
        throw new TypeError();
      const file = config.parseFile(JSON.parse(raw.replace(/^\uFEFF/, '')));
      assertProposalSubmissionBinding(file.document.binding, binding);
      selectionSize(file.document.entries.length);
      const actual = await backupHash(config.documentJson(file.document));
      check();
      if (actual !== file.document_sha256 || actual !== digest) throw new TypeError();
      const targets = file.document.entries.map((draft) => ({
        slot: config.key(file.document.binding, draft.request_key),
        raw: config.encode(draft),
        index: JSON.stringify(config.summary(draft)),
      }));
      const result = await inBrowserStores<{ total: number; removed: number; not_present: number }>(
        config.layout,
        'readwrite',
        operationSignal,
        () => ({ total: targets.length, removed: 0, not_present: targets.length }),
        (context) => {
          const present: typeof targets = [];
          const account = config.readBudget();
          let inspected = 0;
          let verified = 0;
          const verify = () => {
            check();
            const item = targets[verified];
            if (!item) {
              context.accept({
                total: targets.length,
                removed: present.length,
                not_present: targets.length - present.length,
              });
              return;
            }
            readBrowserPair(context, item.slot, (_raw, _index, exists) => {
              if (exists) throw new TypeError();
              verified += 1;
              verify();
            });
          };
          const inspect = () => {
            check();
            const item = targets[inspected];
            if (!item) {
              for (const target of present) {
                check();
                context.content.delete(target.slot);
                context.directory.delete(target.slot);
              }
              verify();
              return;
            }
            readBrowserPair(context, item.slot, (body, index, exists) => {
              if (exists) {
                account(body, index);
                config.pair(body, index, file.document.binding, item.slot);
                if (body !== item.raw || index !== item.index) throw new TypeError();
                present.push(item);
              }
              inspected += 1;
              inspect();
            });
          };
          inspect();
        },
        { create: false },
      );
      check();
      return result;
    });
  }
  return {
    prepare,
    remove,
    filename: config.kind + '-selected.json',
    documentBytes: config.documentBytes,
  };
}

export interface SavedCopyCleanup<
  Draft extends SavedCopy,
  Summary extends { request_key: string },
> {
  prepare: (
    binding: ProposalSubmissionBinding,
    selections: Summary[],
    signal: AbortSignal,
  ) => Promise<ReviewedSavedSelection<Draft>>;
  remove: (
    raw: string,
    binding: ProposalSubmissionBinding,
    digest: string,
    signal: AbortSignal,
  ) => Promise<{ total: number; removed: number; not_present: number }>;
  filename: string;
  documentBytes: number;
}
