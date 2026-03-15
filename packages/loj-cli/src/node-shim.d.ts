declare const process: {
  argv: string[];
  cwd(): string;
  env: Record<string, string | undefined>;
  platform: string;
  execPath: string;
  pid: number;
  exitCode?: number;
  exit(code?: number): never;
  kill(pid: number, signal?: string | number): void;
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): void;
  off(event: 'SIGINT' | 'SIGTERM', listener: () => void): void;
  stdout: { write(text: string): void };
  stderr: { write(text: string): void };
};

declare function setTimeout(listener: () => void, delay: number): { unref(): void };

declare module 'node:fs' {
  export function existsSync(path: string | URL): boolean;
  export function readFileSync(path: string, encoding: string): string;
  export function writeFileSync(path: string, data: string, encoding?: string): void;
  export function mkdirSync(path: string | URL, options?: { recursive?: boolean }): string | undefined;
  export function rmSync(path: string | URL, options?: { force?: boolean; recursive?: boolean }): void;
  export function readdirSync(path: string | URL): string[];
  export function readdirSync(
    path: string | URL,
    options: { withFileTypes: true },
  ): Array<{
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
  }>;
  export function watch(
    path: string | URL,
    listener: (eventType: string, filename?: string | null) => void,
  ): { close(): void };
}

declare module 'node:child_process' {
  export function spawn(
    command: string,
    args?: string[],
    options?: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      stdio?: ['ignore', 'pipe', 'pipe'] | 'inherit';
    },
  ): {
    readonly exitCode: number | null;
    readonly signalCode: string | null;
    stdout?: {
      on(event: 'data', listener: (chunk: { toString(): string }) => void): void;
    };
    stderr?: {
      on(event: 'data', listener: (chunk: { toString(): string }) => void): void;
    };
    on(event: 'exit', listener: (code: number | null, signal: string | null) => void): void;
    kill(signal?: string): void;
  };
  export function spawnSync(
    command: string,
    args?: string[],
    options?: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      stdio?: 'inherit';
    },
  ): {
    error?: Error;
    status: number | null;
    signal: string | null;
  };
}

declare module 'node:path' {
  export function dirname(path: string): string;
  export function resolve(...paths: string[]): string;
  export function basename(path: string, suffix?: string): string;
  export function relative(from: string, to: string): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}

declare module 'node:crypto' {
  export function createHash(
    algorithm: string,
  ): {
    update(data: string): { digest(encoding: 'hex'): string };
  };
}
