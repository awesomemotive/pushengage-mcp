// src/auth/api.ts
import type { ApiClient } from '../http/client';

export type LogoutResponse = {
  logout: boolean;
};

/** Revoke the current session JWT on the PushEngage API (POST /d/v1/auth/logout). */
export async function logoutSession(client: ApiClient): Promise<LogoutResponse> {
  return client.post<LogoutResponse>('/auth/logout', {});
}
