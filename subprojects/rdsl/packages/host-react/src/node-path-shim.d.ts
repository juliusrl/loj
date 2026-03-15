declare module 'node:path' {
  interface PathModule {
    resolve(...segments: string[]): string;
    relative(from: string, to: string): string;
  }

  const path: PathModule;
  export default path;
}
