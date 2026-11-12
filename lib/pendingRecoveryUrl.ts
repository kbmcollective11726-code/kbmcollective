/** Full URL from email (includes #access_token=…) — path-only routing drops the hash. */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { resetPasswordRecoveryHandoffState } from './passwordRecoveryHandoff';

import { isPasswordRecoveryLaunchUrl } from './passwordRecoveryLaunchUrl';



const STORAGE_KEY = 'collectivelive_pending_recovery_url';



let pending: string | null = null;

let hydratePromise: Promise<string | null> | null = null;



export function setPendingPasswordRecoveryUrl(url: string): void {

  if (pending !== url) {

    resetPasswordRecoveryHandoffState();

  }

  pending = url;

  void AsyncStorage.setItem(STORAGE_KEY, url).catch(() => {});

}



/** Restore pending URL after an OTA reload (in-memory queue is lost on reload). */

export function hydratePendingPasswordRecoveryUrl(): Promise<string | null> {

  if (pending) return Promise.resolve(pending);

  if (!hydratePromise) {

    hydratePromise = AsyncStorage.getItem(STORAGE_KEY)

      .then((stored) => {

        if (stored && isPasswordRecoveryLaunchUrl(stored)) {

          pending = stored;

          return stored;

        }

        return null;

      })

      .catch(() => null)

      .finally(() => {

        hydratePromise = null;

      });

  }

  return hydratePromise;

}



/** Non-destructive read (e.g. navigate once navigation tree is ready). */

export function peekPendingPasswordRecoveryUrl(): string | null {

  return pending;

}



export function consumePendingPasswordRecoveryUrl(): string | null {

  const u = pending;

  pending = null;

  return u;

}



export function clearPendingPasswordRecoveryUrl(): void {

  pending = null;

  void AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});

}

