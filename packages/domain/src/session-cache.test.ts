import { describe, it, expect, vi } from 'vitest';

interface CachedSession {
  accessToken: string;
  accessExpiresAt: string;
  person: { id: number; name: string; role: 'R' | 'A' | 'S' };
}

function isSessionValid(session: CachedSession, nowMs: number = Date.now()): boolean {
  if (!session.accessToken) return false;
  const expiry = new Date(session.accessExpiresAt).getTime();
  return !Number.isNaN(expiry) && expiry > nowMs;
}

function parseSessionSafely(rawJson: string | null): CachedSession | null {
  if (!rawJson) return null;
  try {
    const data = JSON.parse(rawJson) as Partial<CachedSession>;
    if (!data.accessToken || typeof data.accessToken !== 'string') return null;
    if (!data.accessExpiresAt || typeof data.accessExpiresAt !== 'string') return null;
    if (!data.person || typeof data.person.id !== 'number') return null;
    return data as CachedSession;
  } catch {
    return null;
  }
}

function formatBearer(token: string | null): Record<string, string> {
  if (!token) return {};
  return { authorization: `Bearer ${token}` };
}

class SingleFlightDebouncer {
  private inFlight: Promise<string> | null = null;
  public callCount = 0;

  public execute(fetcher: () => Promise<string>): Promise<string> {
    if (this.inFlight) return this.inFlight;
    this.callCount += 1;
    this.inFlight = fetcher().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }
}

describe('Session Storage & Single-Flight Refresh Debouncing', () => {
  it('identifies unexpired sessions as valid', () => {
    const validSession: CachedSession = {
      accessToken: 'token-abc',
      accessExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      person: { id: 1, name: 'Aarav Sharma', role: 'R' },
    };
    expect(isSessionValid(validSession)).toBe(true);
  });

  it('identifies expired sessions as invalid', () => {
    const expiredSession: CachedSession = {
      accessToken: 'token-abc',
      accessExpiresAt: new Date(Date.now() - 1000).toISOString(),
      person: { id: 1, name: 'Aarav Sharma', role: 'R' },
    };
    expect(isSessionValid(expiredSession)).toBe(false);
  });

  it('rejects session with empty access token string', () => {
    const emptySession: CachedSession = {
      accessToken: '',
      accessExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      person: { id: 1, name: 'Aarav Sharma', role: 'R' },
    };
    expect(isSessionValid(emptySession)).toBe(false);
  });

  it('parses valid JSON into CachedSession structure', () => {
    const raw = JSON.stringify({
      accessToken: 'jwt.token.here',
      accessExpiresAt: '2026-09-12T12:00:00Z',
      person: { id: 3, name: 'Saarathi Niranjan Kumar', role: 'R' },
    });
    const parsed = parseSessionSafely(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.person.name).toBe('Saarathi Niranjan Kumar');
  });

  it('handles corrupted JSON strings safely without throwing', () => {
    expect(parseSessionSafely('{bad json: true')).toBeNull();
    expect(parseSessionSafely(null)).toBeNull();
    expect(parseSessionSafely('')).toBeNull();
    expect(parseSessionSafely(JSON.stringify({ incomplete: true }))).toBeNull();
  });

  it('formats authorization bearer header dictionary accurately', () => {
    expect(formatBearer('secret-jwt')).toEqual({ authorization: 'Bearer secret-jwt' });
    expect(formatBearer(null)).toEqual({});
    expect(formatBearer('')).toEqual({});
  });

  it('debounces multiple concurrent refresh calls into exactly one execution', async () => {
    const debouncer = new SingleFlightDebouncer();
    const fetcher = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return 'new-access-token';
    });

    const [res1, res2, res3] = await Promise.all([
      debouncer.execute(fetcher),
      debouncer.execute(fetcher),
      debouncer.execute(fetcher),
    ]);

    expect(res1).toBe('new-access-token');
    expect(res2).toBe('new-access-token');
    expect(res3).toBe('new-access-token');
    expect(debouncer.callCount).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('allows a subsequent call after previous execution settles', async () => {
    const debouncer = new SingleFlightDebouncer();
    const fetcher = vi.fn(() => Promise.resolve('fresh-token'));

    await debouncer.execute(fetcher);
    expect(debouncer.callCount).toBe(1);

    await debouncer.execute(fetcher);
    expect(debouncer.callCount).toBe(2);
  });
});
