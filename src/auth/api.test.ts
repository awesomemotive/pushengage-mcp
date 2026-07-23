// src/auth/api.test.ts
import { logoutSession } from './api';
import type { ApiClient } from '../http/client';

describe('logoutSession', () => {
  it('calls POST /auth/logout with an empty body', async () => {
    const post = jest.fn().mockResolvedValue({ logout: true });
    const client = { post } as unknown as ApiClient;

    const result = await logoutSession(client);

    expect(post).toHaveBeenCalledWith('/auth/logout', {});
    expect(result).toEqual({ logout: true });
  });
});
