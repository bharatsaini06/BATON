// Minimal React typings used only for `tsc` type-checking in environments without @types/react.
// They keep hooks and component props loosely typed; runtime behaviour comes from the real React.
declare module "react" {
  export type ReactNode = any;
  export type ReactElement = any;
  export type FC<P = {}> = (props: P) => any;
  export type MouseEvent<T = any> = any;
  export type DragEvent<T = any> = any;
  export type ChangeEvent<T = any> = any;
  export type KeyboardEvent<T = any> = any;
  export type ButtonHTMLAttributes<T = any> = { [k: string]: any; children?: any; className?: string; disabled?: boolean; onClick?: (e: any) => void };
  export function useState<S>(init: S | (() => S)): [S, (v: S | ((p: S) => S)) => void];
  export function useEffect(fn: () => void | (() => void), deps?: any[]): void;
  export function useMemo<T>(fn: () => T, deps: any[]): T;
  export function useCallback<T extends (...a: any[]) => any>(fn: T, deps: any[]): T;
  export function useRef<T>(init?: T | null): { current: T };
  export function useContext<T>(c: Context<T>): T;
  export function useSyncExternalStore<T>(sub: (cb: () => void) => () => void, get: () => T): T;
  export interface Context<T> { Provider: any; Consumer: any }
  export interface SVGAttributes<T> { [k: string]: any }
  export interface HTMLAttributes<T> { [k: string]: any }
  export interface CSSProperties { [k: string]: any }
  export type JSX = any;
  export function createContext<T>(v: T): Context<T>;
  export const StrictMode: any;
  const React: any;
  export default React;
}
declare module "react/jsx-runtime" { export const jsx: any; export const jsxs: any; export const Fragment: any; }
declare module "react-dom/client" { export function createRoot(el: Element): { render(n: any): void }; }
declare namespace JSX {
  interface IntrinsicElements { [el: string]: any }
  interface Element {}
  interface ElementChildrenAttribute { children: {} }
  interface IntrinsicAttributes { key?: any }
}
declare namespace React { type ReactNode = any; }
