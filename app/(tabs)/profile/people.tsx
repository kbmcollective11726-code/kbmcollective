import { useEffect } from 'react';
import { useRouter } from 'expo-router';

/**
 * People has been replaced by Community. Redirect to the Community tab.
 */
export default function PeopleRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/(tabs)/community');
  }, [router]);

  return null;
}
