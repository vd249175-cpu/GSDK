import { createServer, type Server } from 'node:net';
import { createInterface } from 'node:readline';
import { afterEach, describe, expect, it } from 'vitest';
import { connectKernelDaemon } from '../src/agent/daemon-client';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('KernelDaemonClient', () => {
  it('correlates concurrent DTO requests and keeps credentials out of the public method payload', async () => {
    const requests: Record<string, unknown>[] = [];
    const server = createServer((socket) => {
      const lines = createInterface({ input: socket, crlfDelay: Infinity });
      lines.on('line', (line) => {
        const request = JSON.parse(line) as Record<string, unknown>;
        requests.push(request);
        const delay = request.op === 'health' ? 10 : 0;
        setTimeout(() => socket.write(`${JSON.stringify({
          id: request.id, ok: true, result: request.op === 'health' ? { pid: 7, nodes: 0, pending: 0, leases: 0 }
            : request.op === 'shutdown' ? { shutdown: true } : { pending: 0 },
        })}\n`), delay);
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture server has no TCP address');

    const client = await connectKernelDaemon({ address: `127.0.0.1:${address.port}`, token: 'fixture-secret-0001' });
    try {
      const [health, projection] = await Promise.all([client.health(), client.projection()]);
      expect(health.pid).toBe(7);
      expect(projection).toEqual({ pending: 0 });
      expect(requests).toHaveLength(2);
      expect(requests.every((request) => request.version === 1 && request.token === 'fixture-secret-0001')).toBe(true);
      const shutdown = client.shutdown();
      expect(client.shutdown()).toBe(shutdown);
      expect(await shutdown).toEqual({ shutdown: true });
      expect(requests.filter((request) => request.op === 'shutdown')).toHaveLength(1);
      expect(requests.at(-1)?.op).toBe('shutdown');
    } finally {
      client.close();
    }
  });

  it('turns protocol failures into rejected requests without closing the connection', async () => {
    const server = createServer((socket) => {
      const lines = createInterface({ input: socket, crlfDelay: Infinity });
      lines.on('line', (line) => {
        const request = JSON.parse(line) as Record<string, unknown>;
        socket.write(`${JSON.stringify({ id: request.id, ok: false, error: 'state version conflict' })}\n`);
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture server has no TCP address');
    const client = await connectKernelDaemon({ address: `127.0.0.1:${address.port}`, token: 'fixture-secret-0001' });
    try {
      await expect(client.intervene('owner', { count: 5 }, 0, 0)).rejects.toThrow('state version conflict');
      await expect(client.health()).rejects.toThrow('state version conflict');
    } finally {
      client.close();
    }
  });
});
