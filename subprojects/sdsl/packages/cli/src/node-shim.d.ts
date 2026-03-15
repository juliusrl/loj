declare module 'node:fs' {
  export function existsSync(path: string | URL): boolean;
  export function readFileSync(path: string | URL, encoding: string): string;
  export function writeFileSync(path: string | URL, data: string, encoding?: string): void;
  export function mkdirSync(path: string | URL, options?: { recursive?: boolean }): string | undefined;
  export function mkdtempSync(prefix: string): string;
  export function rmSync(path: string | URL, options?: { recursive?: boolean; force?: boolean }): void;
  export function readdirSync(path: string | URL): string[];
  export function watch(
    path: string | URL,
    listener: (eventType: string, filename?: string | null) => void,
  ): { close(): void };
}

declare module 'node:path' {
  export function resolve(...paths: string[]): string;
  export function dirname(path: string): string;
  export function join(...paths: string[]): string;
  export function basename(path: string, suffix?: string): string;
}

declare module 'node:url' {
  export function pathToFileURL(path: string): URL;
}

declare module 'node:os' {
  export function tmpdir(): string;
}

declare const process: {
  argv: string[];
  cwd(): string;
  env: Record<string, string | undefined>;
  stdout: { write(text: string): void };
  stderr: { write(text: string): void };
  exitCode?: number;
};
