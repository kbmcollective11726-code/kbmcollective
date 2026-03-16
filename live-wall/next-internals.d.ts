// Fix Next.js build: generated .next/types reference internal modules that lack declarations
declare module 'next/dist/lib/metadata/types/metadata-interface.js' {
  export type ResolvingMetadata = unknown;
  export type ResolvingViewport = unknown;
}

// Ensure Next.js runtime modules resolve when TypeScript resolution misses them
declare module 'next/link' {
  import type { ComponentType } from 'react';
  const Link: ComponentType<any>;
  export default Link;
}

declare module 'next/navigation' {
  export function useSearchParams(): ReadonlyURLSearchParams;
  export function usePathname(): string;
  export function useRouter(): { push: (url: string) => void; replace: (url: string) => void; back: () => void };
}
interface ReadonlyURLSearchParams {
  get(name: string): string | null;
  getAll(name: string): string[];
  has(name: string): boolean;
  keys(): IterableIterator<string>;
  entries(): IterableIterator<[string, string]>;
  forEach(callback: (value: string, key: string) => void): void;
  toString(): string;
}
