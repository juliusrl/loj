export type ReactDslHostTemplateFileMode = 'managed' | 'starter';
export interface ReactDslHostTemplateFile {
    path: string;
    mode: ReactDslHostTemplateFileMode;
    content: string;
}
export interface ReactDslHostTemplateManifest {
    artifact: 'rdsl.host-template';
    template: 'react-vite';
    version: string;
    title: string;
    defaults: {
        generatedDir: string;
        apiBase: string;
        host: string;
        port: number;
        previewPort: number;
    };
    managedFiles: string[];
    starterFiles: string[];
}
export interface ReactDslHostTemplate {
    manifest: ReactDslHostTemplateManifest;
    files: ReactDslHostTemplateFile[];
}
export interface CreateReactDslViteHostTemplateOptions {
    title?: string;
    packageName?: string;
    defaultGeneratedDir?: string;
    defaultApiBase?: string;
    defaultHost?: string;
    defaultPort?: number;
    defaultPreviewPort?: number;
}
export declare function createReactDslViteHostTemplate(options?: CreateReactDslViteHostTemplateOptions): ReactDslHostTemplate;
//# sourceMappingURL=template.d.ts.map