import assert from 'node:assert/strict';
import test from 'node:test';
import { erApi, ErApiError } from '../../erd-api.ts';
import { emptyModel } from './model.ts';

test('ERD requests use the frozen prefix, bodies and expected revisions', async () => {
  const original = globalThis.fetch, calls = [], model = emptyModel();
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options });
    return new Response(options.method === 'DELETE' ? null : JSON.stringify({ models: [] }), { status: options.method === 'DELETE' ? 204 : 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await erApi.list(); await erApi.open('a/b'); await erApi.create('Name', model);
    await erApi.save('id', 'Name', 7, model); await erApi.delete('id', 7); await erApi.sql(model);
    assert.deepEqual(calls.map(call => [call.url, call.method]), [
      ['/api/erd-models', 'GET'], ['/api/erd-models/a%2Fb', 'GET'], ['/api/erd-models', 'POST'],
      ['/api/erd-models/id', 'PUT'], ['/api/erd-models/id', 'DELETE'], ['/api/erd-export', 'POST'],
    ]);
    assert.equal(calls[0].body, undefined);
    assert.deepEqual(JSON.parse(calls[2].body), { name: 'Name', model });
    assert.deepEqual(JSON.parse(calls[3].body), { name: 'Name', expectedRevision: 7, model });
    assert.deepEqual(JSON.parse(calls[4].body), { expectedRevision: 7 });
    assert.deepEqual(JSON.parse(calls[5].body), { model });
    assert.deepEqual(calls[3].headers, { 'Content-Type': 'application/json' });
  } finally { globalThis.fetch = original; }
});
test('conflicts surface verbatim without retrying or rebasing the revision', async () => {
  const original = globalThis.fetch; let count = 0;
  globalThis.fetch = async () => { count++; return new Response(JSON.stringify({ error: 'Revision conflict.' }), { status: 409 }); };
  try {
    await assert.rejects(erApi.save('id', 'Name', 4, emptyModel()), error => error instanceof ErApiError && error.status === 409 && error.message === 'Revision conflict.');
    assert.equal(count, 1);
  } finally { globalThis.fetch = original; }
});
test('network and non-JSON failures remain actionable errors', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error('offline'); };
    await assert.rejects(erApi.list(), /Could not reach the local server/);
    globalThis.fetch = async () => new Response('Failure', { status: 500 });
    await assert.rejects(erApi.list(), error => error.status === 500 && /Request failed/.test(error.message));
  } finally { globalThis.fetch = original; }
});
