import { useDeepLink } from '../lib/useDeepLink';

/** Mount inside a Stack/Tabs layout — not in root _layout (router runs before navigator mounts). */
export default function DeepLinkHandler() {
  useDeepLink();
  return null;
}
