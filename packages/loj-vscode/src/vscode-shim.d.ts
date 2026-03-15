declare module 'vscode' {
  export type Thenable<T> = PromiseLike<T>;

  export interface Disposable {
    dispose(): void;
  }

  export interface ExtensionContext {
    subscriptions: { push(...disposables: Disposable[]): void };
  }

  export class EventEmitter<T> implements Disposable {
    constructor();
    event: unknown;
    fire(data?: T): void;
    dispose(): void;
  }

  export interface Uri {
    fsPath: string;
    scheme: string;
  }

  export interface Position {
    line: number;
    character: number;
  }

  export class Range {
    constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number);
    start: Position;
    end: Position;
  }

  export class Location {
    constructor(uri: Uri, range: Range);
    uri: Uri;
    range: Range;
  }

  export class MarkdownString {
    constructor(value?: string);
    value: string;
  }

  export class Hover {
    constructor(contents: MarkdownString | string);
  }

  export enum DiagnosticSeverity {
    Error = 0,
    Warning = 1,
    Information = 2,
    Hint = 3
  }

  export class Diagnostic {
    constructor(range: Range, message: string, severity?: DiagnosticSeverity);
    range: Range;
    message: string;
    severity?: DiagnosticSeverity;
    source?: string;
  }

  export interface DiagnosticCollection extends Disposable {
    set(uri: Uri, diagnostics: Diagnostic[]): void;
    delete(uri: Uri): void;
  }

  export interface TextDocument {
    uri: Uri;
    fileName: string;
    languageId: string;
    isDirty: boolean;
    getText(): string;
  }

  export interface TextEditor {
    document: TextDocument;
    selection: {
      active: Position;
    };
  }

  export interface TextDocumentShowOptions {
    preview?: boolean;
    preserveFocus?: boolean;
    selection?: Range;
  }

  export interface HoverProvider {
    provideHover(document: TextDocument, position: Position): ProviderResult<Hover>;
  }

  export interface DefinitionProvider {
    provideDefinition(document: TextDocument, position: Position): ProviderResult<Location | readonly Location[]>;
  }

  export class SnippetString {
    constructor(value?: string);
    value: string;
  }

  export enum CompletionItemKind {
    Text = 0,
    Method = 1,
    Function = 2,
    Constructor = 3,
    Field = 4,
    Variable = 5,
    Class = 6,
    Interface = 7,
    Module = 8,
    Property = 9,
    Unit = 10,
    Value = 11,
    Enum = 12,
    Keyword = 13,
    Snippet = 14
  }

  export class CompletionItem {
    constructor(label: string, kind?: CompletionItemKind);
    label: string;
    kind?: CompletionItemKind;
    detail?: string;
    insertText?: string | SnippetString;
    sortText?: string;
  }

  export interface CompletionItemProvider {
    provideCompletionItems(document: TextDocument, position: Position): ProviderResult<CompletionItem[]>;
  }

  export class WorkspaceEdit {
    replace(uri: Uri, range: Range, newText: string): void;
  }

  export class CodeAction {
    constructor(title: string, kind?: string);
    title: string;
    kind?: string;
    diagnostics?: Diagnostic[];
    edit?: WorkspaceEdit;
    command?: Command;
  }

  export const CodeActionKind: {
    QuickFix: string;
  };

  export interface CodeActionContext {
    diagnostics: readonly Diagnostic[];
  }

  export interface CodeActionProvider {
    provideCodeActions(document: TextDocument, range: Range, context: CodeActionContext): ProviderResult<CodeAction[]>;
  }

  export type ProviderResult<T> = T | undefined | null | Thenable<T | undefined | null>;

  export interface QuickPickItem {
    label: string;
    description?: string;
    detail?: string;
  }

  export interface QuickPickOptions {
    title?: string;
    placeHolder?: string;
  }

  export interface Command {
    title: string;
    command: string;
    arguments?: readonly unknown[];
  }

  export enum TreeItemCollapsibleState {
    None = 0,
    Collapsed = 1,
    Expanded = 2
  }

  export class ThemeIcon {
    constructor(id: string);
  }

  export class TreeItem {
    constructor(label: string, collapsibleState?: TreeItemCollapsibleState);
    label: string;
    description?: string;
    detail?: string;
    tooltip?: string;
    command?: Command;
    iconPath?: ThemeIcon;
  }

  export interface TreeDataProvider<T> {
    getTreeItem(element: T): TreeItem | Thenable<TreeItem>;
    getChildren(element?: T): ProviderResult<T[]>;
  }

  export interface WorkspaceFolder {
    uri: Uri;
  }

  export interface OutputChannel extends Disposable {
    appendLine(value: string): void;
    clear(): void;
    show(preserveFocus?: boolean): void;
  }

  export enum StatusBarAlignment {
    Left = 1,
    Right = 2
  }

  export interface StatusBarItem extends Disposable {
    text: string;
    tooltip?: string;
    name?: string;
    command?: string;
    show(): void;
    hide(): void;
  }

  export const languages: {
    createDiagnosticCollection(name: string): DiagnosticCollection;
    registerHoverProvider(selector: { language: string; scheme: string }, provider: HoverProvider): Disposable;
    registerDefinitionProvider(selector: { language: string; scheme: string }, provider: DefinitionProvider): Disposable;
    registerCompletionItemProvider(selector: { language: string; scheme: string }, provider: CompletionItemProvider, ...triggerCharacters: string[]): Disposable;
    registerCodeActionsProvider(selector: { language: string; scheme: string }, provider: CodeActionProvider): Disposable;
  };

  export const commands: {
    registerCommand(command: string, callback: (...args: unknown[]) => unknown): Disposable;
    executeCommand<T = unknown>(command: string, ...rest: unknown[]): Thenable<T | undefined>;
  };

  export const workspace: {
    textDocuments: readonly TextDocument[];
    workspaceFolders?: readonly WorkspaceFolder[];
    findFiles(include: string, exclude?: string): Thenable<Uri[]>;
    openTextDocument(uri: Uri): Thenable<TextDocument>;
    onDidOpenTextDocument(listener: (document: TextDocument) => unknown): Disposable;
    onDidChangeTextDocument(listener: (event: { document: TextDocument }) => unknown): Disposable;
    onDidSaveTextDocument(listener: (document: TextDocument) => unknown): Disposable;
    onDidCloseTextDocument(listener: (document: TextDocument) => unknown): Disposable;
  };

  export const window: {
    activeTextEditor?: TextEditor;
    createOutputChannel(name: string): OutputChannel;
    createStatusBarItem(alignment?: StatusBarAlignment, priority?: number): StatusBarItem;
    createTreeView(id: string, options: { treeDataProvider: TreeDataProvider<TreeItem>; showCollapseAll?: boolean }): Disposable;
    showQuickPick<T extends QuickPickItem>(items: readonly T[] | Thenable<readonly T[]>, options?: QuickPickOptions): Thenable<T | undefined>;
    showInputBox(options?: { title?: string; prompt?: string; value?: string }): Thenable<string | undefined>;
    showTextDocument(document: TextDocument, options?: TextDocumentShowOptions): Thenable<TextEditor>;
    onDidChangeActiveTextEditor(listener: (editor: TextEditor | undefined) => unknown): Disposable;
    showWarningMessage(message: string): Thenable<unknown>;
    showInformationMessage(message: string): Thenable<unknown>;
  };

  export const env: {
    openExternal(uri: Uri): Thenable<boolean>;
  };

  export interface DebugConfiguration {
    type: string;
    request: string;
    name: string;
    hostName?: string;
    port?: number;
    connect?: {
      host: string;
      port: number;
    };
    justMyCode?: boolean;
  }

  export const debug: {
    startDebugging(folder: WorkspaceFolder | undefined, configuration: DebugConfiguration): Thenable<boolean>;
  };

  export const Uri: {
    file(path: string): Uri;
    parse(value: string): Uri;
  };
}
