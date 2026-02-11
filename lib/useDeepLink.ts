import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';

/**
 * Handles deep links into the app (e.g. from push notifications).
 * collectivelive://post/<id> -> navigate to Feed and open that post's comments.
 */
export function useDeepLink() {
  const router = useRouter();

  useEffect(() => {
    const handleUrl = (url: string) => {
      try {
        const parsed = Linking.parse(url);
        const path = parsed.path ?? '';
        const segment = path.startsWith('/') ? path.slice(1).split('/') : path.split('/');
        if (segment[0] === 'post' && segment[1]) {
          const postId = segment[1];
          router.replace({ pathname: '/feed', params: { postId } } as any);
        }
      } catch (_) {
        // ignore parse errors
      }
    };

    Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url);
    });

    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, [router]);
}
