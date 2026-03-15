declare module 'node:fs' {
  export function existsSync(path: string | URL): boolean;
  export function readFileSync(path: string | URL, encoding: string): string;
  export function writeFileSync(path: string | URL, data: string, encoding?: string): void;
  export function mkdirSync(path: string | URL, options?: { recursive?: boolean }): string | undefined;
  export function readdirSync(path: string | URL): string[];
  export function statSync(path: string | URL): { isDirectory(): boolean; isFile(): boolean };
}

declare module 'node:path' {
  export function resolve(...paths: string[]): string;
  export function dirname(path: string): string;
  export function join(...paths: string[]): string;
  export function basename(path: string, suffix?: string): string;
  export function relative(from: string, to: string): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}

declare const process: {
  argv: string[];
  cwd(): string;
  stdout: { write(text: string): void };
  stderr: { write(text: string): void };
  exitCode?: number;
};
