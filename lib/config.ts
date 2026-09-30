export const FIXED_SESSION_ID = 'mosque-724034';
export const DEFAULT_SOURCE_LANG = 'ar';
export const DEFAULT_TARGET_LANG = 'ur';

export function getWebSocketUrl(sessionId: string = FIXED_SESSION_ID): string {
  let base = process.env.NEXT_PUBLIC_WEBSOCKET_URL || 'wss://noor-live-ws.onrender.com';
  
  if (typeof window !== 'undefined') {
    const isLocalhostConfig = base.includes('localhost') || base.includes('127.0.0.1');
    if (
      isLocalhostConfig &&
      window.location.hostname &&
      window.location.hostname !== 'localhost' &&
      window.location.hostname !== '127.0.0.1'
    ) {
      const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      base = `${wsProto}//${window.location.hostname}:8080`;
    }
  }

  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}session=${sessionId}`;
}
