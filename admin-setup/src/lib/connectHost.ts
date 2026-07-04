export const CONNECT_HOST = 'connect.kbmcollective.org';
export const CADMIN_HOST = 'cadmin.kbmcollective.org';

export function isConnectHost(): boolean {
  return typeof window !== 'undefined' && window.location.hostname === CONNECT_HOST;
}
