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
  type SetStateAction<S> = S | ((prev: S) => S);
  type Dispatch<A> = (value: A) => void;
  interface Context<T> {
    Provider: (props: { value: T; children?: ReactNode }) => any;
  }
  interface MouseEvent<T = any> {
    defaultPrevented: boolean;
    button: number;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    target: T;
    preventDefault(): void;
  }
}

declare module 'react' {
  const React: {
    Fragment: any;
    StrictMode: any;
    createElement(type: any, props?: any, ...children: any[]): any;
    createContext<T>(defaultValue: T): React.Context<T>;
    useContext<T>(context: React.Context<T>): T;
    useState<S>(initialState: S | (() => S)): [S, React.Dispatch<React.SetStateAction<S>>];
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
    useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
    useCallback<T extends (...args: any[]) => any>(callback: T, deps: readonly unknown[]): T;
  };
  export default React;
  export const Fragment: typeof React.Fragment;
  export const StrictMode: typeof React.StrictMode;
  export const createElement: typeof React.createElement;
  export const createContext: typeof React.createContext;
  export const useContext: typeof React.useContext;
  export const useState: typeof React.useState;
  export const useEffect: typeof React.useEffect;
  export const useMemo: typeof React.useMemo;
  export const useCallback: typeof React.useCallback;
}
