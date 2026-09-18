import { createServer, request } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Authenticated run-local RPC. It owns no kernel or lifecycle sequence. */
export async function serveRunControl({ token, runId, handlers, concurrent = [] }) {
  let queue = Promise.resolve();
  const server = createServer(async (req, res) => {
    const supplied = Buffer.from(String(req.headers.authorization ?? ''));
    const expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.writeHead(403).end(); return;
    }
    try {
      if (req.method !== 'POST' || req.url !== '/') throw new Error('invalid control request');
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 2_000_000) throw new Error('control request too large');
      }
      const input = JSON.parse(body);
      if (input.runId !== runId) throw new Error('run identity mismatch');
      const handler = handlers[input.op];
      if (typeof handler !== 'function') throw new Error(`unknown control operation: ${input.op}`);
      const run = () => handler(input.payload ?? {});
      const independent = ['health', 'request-stop', 'wait-stop', 'projection', ...concurrent].includes(input.op);
      const operation = independent ? run() : queue.then(run);
      if (!independent) queue = operation.catch(() => undefined);
      const output = await operation;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ runId, ok: true, output }));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ runId, ok: false, error: error?.message ?? String(error) }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = `http://127.0.0.1:${server.address().port}`;
  return { address, async close() {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  } };
}

export function callRunControl(runtime, op, payload = {}, timeoutMs = 60_000, recordName = 'control.json') {
  const record = JSON.parse(readFileSync(join(runtime, recordName), 'utf8'));
  const token = readFileSync(join(runtime, 'control-token'), 'utf8').trim();
  const body = JSON.stringify({ runId: record.runId, op, payload });
  return new Promise((resolve, reject) => {
    const req = request(record.address, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.runId !== record.runId || !response.ok) throw new Error(response.error ?? 'control identity mismatch');
          resolve(response.output);
        } catch (error) { reject(error); }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`${op} timed out`)));
    req.on('error', reject);
    req.end(body);
  });
}
