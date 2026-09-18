import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioStudioClient } from './audio-client';

describe('AudioStudioClient gateway contract', () => {
  afterEach(() => {
    delete (globalThis as any).window;
  });

  it('uses the gateway GET voice list route and accepts its array response', async () => {
    const voices = [{ voice_id: 'actor' }];
    const dispatch = vi.fn().mockResolvedValue({ ok: true, status: 200, data: voices });
    (globalThis as any).window = { graphvideoDesktop: { audioStudio: { dispatch } } };
    const client = new AudioStudioClient({ baseUrl: 'http://audio.test/api/v1', projectId: 'film' });

    await expect(client.listVoices()).resolves.toEqual(voices);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      url: 'http://audio.test/api/v1/projects/film/voice/list',
      method: 'GET',
    }));
  });

  it('creates a missing project and keeps voice design inside that project', async () => {
    const dispatch = vi.fn(async ({ url, method }: { url: string; method: string }) => {
      if (method === 'GET' && url.endsWith('/projects/film')) {
        return { ok: false, status: 404, error: 'not found' };
      }
      if (method === 'POST' && url.endsWith('/projects')) {
        return { ok: true, status: 200, data: { project_id: 'film' } };
      }
      if (method === 'POST' && url.endsWith('/projects/film/voice/design')) {
        return { ok: true, status: 200, data: { voice_id: 'actor', sample_url: '/sample.wav' } };
      }
      return { ok: false, status: 500, error: 'unexpected request' };
    });
    (globalThis as any).window = { graphvideoDesktop: { audioStudio: { dispatch } } };
    const client = new AudioStudioClient({ baseUrl: 'http://audio.test/api/v1', projectId: 'film' });

    await expect(client.designVoice({
      voice_id: 'actor',
      name: 'Actor',
      description: 'warm voice',
    })).resolves.toMatchObject({ voice_id: 'actor' });
    expect(dispatch.mock.calls.some(([request]) => request.url.includes('/projects/default/'))).toBe(false);
  });

  it('does not retry a failed project voice request in the default project', async () => {
    const dispatch = vi.fn(async ({ url, method }: { url: string; method: string }) => {
      if (method === 'GET') return { ok: true, status: 200, data: { project_id: 'film' } };
      if (url.endsWith('/projects/film/voice/design')) {
        return { ok: false, status: 500, error: 'Higgs unavailable' };
      }
      return { ok: false, status: 500, error: 'unexpected fallback' };
    });
    (globalThis as any).window = { graphvideoDesktop: { audioStudio: { dispatch } } };
    const client = new AudioStudioClient({ baseUrl: 'http://audio.test/api/v1', projectId: 'film' });

    await expect(client.designVoice({
      voice_id: 'actor',
      name: 'Actor',
      description: 'warm voice',
    })).rejects.toThrow('Higgs unavailable');
    expect(dispatch.mock.calls.some(([request]) => request.url.includes('/projects/default/'))).toBe(false);
  });

  it('decodes generated audio returned through the Electron binary DTO', async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      kind: 'binary',
      dataBase64: Buffer.from('RIFF....WAVEfmt....data').toString('base64'),
    });
    (globalThis as any).window = { graphvideoDesktop: { audioStudio: { dispatch } } };
    const client = new AudioStudioClient({
      baseUrl: 'http://audio.test/api/v1',
      projectId: 'debug_project',
    });

    const result = await client.generateSfx({
      prompt: 'Cinematic cello and clarinet',
      duration: 15,
      steps: 50,
      cfg_scale: 6,
    });

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      url: 'http://audio.test/api/v1/projects/debug_project/audio/generate',
      method: 'POST',
    }));
    expect(result).toMatchObject({ kind: 'audio' });
    expect(result.audioBlob).toBeInstanceOf(Blob);
  });
});
