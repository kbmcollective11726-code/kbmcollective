import type { Href } from 'expo-router';

export interface RouterLike {
  replace: (href: Href) => void;
}

/** Defer navigation until after the navigator has committed (fixes Android cold-start races). */
export function safeRouterReplace(router: RouterLike, href: Href): void {
  requestAnimationFrame(() => {
    try {
      router.replace(href);
    } catch {
      setTimeout(() => {
        try {
          router.replace(href);
        } catch {
          /* navigator still not ready */
        }
      }, 32);
    }
  });
}
