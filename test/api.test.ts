import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

process.env.CWS_CLIENT_ID = 'test-client';
process.env.CWS_CLIENT_SECRET = 'test-secret';
process.env.CWS_REFRESH_TOKEN = 'test-refresh';
const { createServer, createSandboxServer } = await import('../src/index.js');

async function connect(factory = createServer) {
  const server = factory();
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

test('get and extension resource use v2 only; legacy projection fails before network access', async t => {
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    urls.push(String(url));
    return new Response(JSON.stringify(String(url).includes('oauth2') ? { access_token: 'test-token', expires_in: 3600 } : { itemId: 'abc', lastAsyncUploadState: 'SUCCEEDED' }));
  });
  const { client, close } = await connect();
  try {
    const removed = await client.callTool({ name: 'get', arguments: { itemId: 'abc', projection: 'PUBLISHED' } });
    assert.equal(removed.isError, true); assert.equal(urls.length, 0);
    const result = await client.callTool({ name: 'get', arguments: { itemId: 'abc' } });
    assert.equal(result.isError, false);
    const template = await client.listResourceTemplates();
    assert.equal(template.resourceTemplates[0].uriTemplate, 'cws://extensions/{extensionId}');
    await client.readResource({ uri: 'cws://extensions/abc' });
    assert.equal(urls.filter(url => url.includes('/v2/publishers/me/items/abc:fetchStatus')).length, 2);
    assert.equal(urls.some(url => url.includes('v1.1')), false);
  } finally { await close(); }
});

test('publish forwards blockOnWarnings including false and preserves warning details', async t => {
  const bodies: any[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    if (String(_url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }));
    bodies.push(JSON.parse(String(options.body)));
    return new Response(JSON.stringify({ warningInfo: { warnings: [{ reason: 'WARNING', description: 'Check listing' }] } }));
  });
  const { client, close } = await connect();
  try {
    for (const blockOnWarnings of [true, false]) {
      const result = await client.callTool({ name: 'publish', arguments: { itemId: 'abc', blockOnWarnings } });
      assert.match(JSON.stringify(result), /Check listing/);
    }
    assert.deepEqual(bodies, [{ blockOnWarnings: true }, { blockOnWarnings: false }]);
  } finally { await close(); }
});

test('unsupported metadata returns an error before browser or API calls', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Network must not be used'); });
  const { client, close } = await connect();
  try {
    for (const fields of [{ title: 'Name' }, { summary: 'Summary' }, { metadata: { title: 'Name' } }, { storeIconPath: '/icon.png' }]) {
      const result = await client.callTool({ name: 'update-metadata', arguments: { itemId: 'abc', ...fields } });
      assert.equal(result.isError, true);
      assert.doesNotMatch(JSON.stringify(result), /Network must not be used/);
    }
  } finally { await close(); }
});

test('sandbox and real tool schemas agree after v1 removal', async () => {
  const real = await connect(); const sandbox = await connect(createSandboxServer);
  try {
    const [a, b] = await Promise.all([real.client.listTools(), sandbox.client.listTools()]);
    const schemas = (tools: any[]) => Object.fromEntries(tools.map(tool => [tool.name, Object.keys(tool.inputSchema.properties).sort()]));
    assert.deepEqual(schemas(a.tools), schemas(b.tools));
  } finally { await real.close(); await sandbox.close(); }
});
