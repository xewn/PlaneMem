declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(location: string);
    exec(sql: string): void;
    prepare(sql: string): {
      run(...parameters: unknown[]): { changes: number | bigint };
      get(...parameters: unknown[]): Record<string, unknown> | undefined;
      all(...parameters: unknown[]): Record<string, unknown>[];
    };
    close(): void;
  }
}
