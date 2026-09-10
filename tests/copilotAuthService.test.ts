import { describe, expect, it } from 'vitest';
import {
  COPILOT_TOKEN_URL,
  COPILOT_MODELS_URL,
  GITHUB_DEVICE_CODE_URL,
  ensureCopilotAuth,
  listCopilotModels,
  refreshCopilotToken,
  requestCopilotDeviceCode,
} from '../src/main/services/copilotAuthService';
import type { SecretBackend } from '../src/main/services/secretBackend';

class FakeSecretBackend implements SecretBackend {
  private readonly values = new Map<string, string>();

  async get(account: string): Promise<string | null> {
    return this.values.get(account) ?? null;
  }

  async set(account: string, secret: string): Promise<void> {
    this.values.set(account, secret);
  }

  async delete(account: string): Promise<boolean> {
    return this.values.delete(account);
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('copilotAuthService', () => {
  it('requests a GitHub device code', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      expect(input).toBe(GITHUB_DEVICE_CODE_URL);
      return jsonResponse({
        device_code: 'device',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://github.com/login/device',
        expires_in: 600,
        interval: 5,
      });
    };

    const result = await requestCopilotDeviceCode({ fetchImpl, clientId: 'test-client' });
    expect(result).toEqual({
      ok: true,
      data: {
        device_code: 'device',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://github.com/login/device',
        expires_in: 600,
        interval: 5,
      },
    });
  });

  it('exchanges a GitHub token for a Copilot token', async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(input).toBe(COPILOT_TOKEN_URL);
      expect((init?.headers as Record<string, string>).Authorization).toBe('token github-token');
      return jsonResponse({ token: 'copilot-token', expires_at: 2_000 });
    };

    const result = await refreshCopilotToken('github-token', { fetchImpl });
    expect(result).toEqual({
      ok: true,
      data: {
        githubAccessToken: 'github-token',
        copilotToken: 'copilot-token',
        copilotTokenExpiresAt: 2_000_000,
      },
    });
  });

  it('uses a non-expired cached Copilot token without a network request', async () => {
    const backend = new FakeSecretBackend();
    await backend.set('githubCopilotAuth', JSON.stringify({
      githubAccessToken: 'github-token',
      copilotToken: 'copilot-token',
      copilotTokenExpiresAt: Date.now() + 120_000,
    }));
    const fetchImpl: typeof fetch = async () => {
      throw new Error('network should not be called');
    };

    const result = await ensureCopilotAuth(backend, { fetchImpl });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.copilotToken).toBe('copilot-token');
  });

  it('returns the models available to the logged-in Copilot subscription', async () => {
    const backend = new FakeSecretBackend();
    await backend.set('githubCopilotAuth', JSON.stringify({
      githubAccessToken: 'github-token',
      copilotToken: 'copilot-token',
      copilotTokenExpiresAt: Date.now() + 120_000,
    }));
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(input).toBe(COPILOT_MODELS_URL);
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer copilot-token');
      return jsonResponse({ data: [{ id: 'gpt-4o', name: 'GPT-4o' }, { id: 'claude-haiku-4.5' }] });
    };

    const result = await listCopilotModels(backend, { fetchImpl });
    expect(result).toEqual({
      ok: true,
      data: [
        { id: 'gpt-4o', name: 'GPT-4o' },
        { id: 'claude-haiku-4.5', name: 'claude-haiku-4.5' },
      ],
    });
  });
});