import { InteractionManager } from 'react-native';
import type { Href, Router } from 'expo-router';

/** Defer navigation until after the navigator has committed (fixes Android cold-start races). */
export function safeRouterReplace(router: Router, href: Href): void {
  InteractionManager.runAfterInteractions(() => {
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
