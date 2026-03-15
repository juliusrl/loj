declare namespace JSX {
  interface Element {}
  interface ElementChildrenAttribute {
    children: {};
  }
  interface IntrinsicElements {
    [elementName: string]: any;
  }
}

declare namespace React {
  type ReactNode = any;
  type ComponentType<P = any> = (props: P) => any;
  interface MutableRefObject<T> {
    current: T;
  }
  interface Context<T> {
    Provider: ComponentType<{ value: T; children?: ReactNode }>;
  }
}

declare module 'react' {
  const React: {
    memo<T>(component: T): T;
    lazy<T>(factory: () => Promise<{ default: T }>): T;
    Suspense: any;
    createElement(type: any, props?: any, ...children: any[]): any;
    createContext<T>(defaultValue: T): React.Context<T>;
    useContext<T>(context: React.Context<T>): T;
    useState<S>(initialState: S | (() => S)): [S, (value: S | ((prev: S) => S)) => void];
    useRef<T>(initialValue: T): React.MutableRefObject<T>;
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
    useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
    useCallback<T extends (...args: any[]) => any>(callback: T, deps: readonly unknown[]): T;
    useDeferredValue<T>(value: T): T;
    startTransition(callback: () => void): void;
  };
  export default React;
  export const memo: typeof React.memo;
  export const lazy: typeof React.lazy;
  export const Suspense: typeof React.Suspense;
  export const createElement: typeof React.createElement;
  export const createContext: typeof React.createContext;
  export const useContext: typeof React.useContext;
  export const useState: typeof React.useState;
  export const useRef: typeof React.useRef;
  export const useEffect: typeof React.useEffect;
  export const useMemo: typeof React.useMemo;
  export const useCallback: typeof React.useCallback;
  export const useDeferredValue: typeof React.useDeferredValue;
  export const startTransition: typeof React.startTransition;
}

declare module '*.css' {
  const css: string;
  export default css;
}

declare module '*.svg' {
  const asset: string;
  export default asset;
}

declare module '*.png' {
  const asset: string;
  export default asset;
}

declare module '*.jpg' {
  const asset: string;
  export default asset;
}

declare module '*.jpeg' {
  const asset: string;
  export default asset;
}

declare module '*.webp' {
  const asset: string;
  export default asset;
}

declare module '*.ico' {
  const asset: string;
  export default asset;
}
