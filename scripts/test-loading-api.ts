import assert from 'node:assert/strict';
import express from 'express';
import { createRequire } from 'node:module';
import { createProductRouter } from '../src/server/routes/productRoutes';
import { matchesProduct } from '../src/lib/productMatch';

delete process.env.CLOUDFLARE_D1_ACCOUNT_ID;
delete process.env.CLOUDFLARE_D1_DATABASE_ID;
delete process.env.CLOUDFLARE_D1_API_TOKEN;
const products = [
  { id: '1', slug: 'argan', name: 'Argan Oil', price: '90 DH', in_catalog: 1 },
  { id: '2', slug: 'jojoba', name: 'Jojoba Oil', price: '80 DH', in_catalog: 1 },
  { id: '3', slug: 'hidden', name: 'Hidden', price: '10 DH', in_catalog: 0 },
];
let catalogReads = 0;
const server = express();
server.use('/api', createProductRouter({
  getProducts: () => { catalogReads++; return products; },
  getD1Products: () => [], setD1Products: () => {},
  getD1ApiCacheProducts: () => ({ data: null, timestamp: 0 }),
  setD1ApiCacheProducts: () => {},
  getStoreSettings: () => ({ enableAr: true, orders_telegramBotToken: 'private', orders_telegramChatId: 'private' }),
  refreshStoreSettings: async () => {}, fetchProductsFromD1: async () => null,
  syncD1ToClassicProducts: () => {}, mapD1RowToProductSchema: row => row,
  ensureProductsDataTablesExist: async () => true,
}));
const listener = server.listen(0, '127.0.0.1');
await new Promise<void>(resolve => listener.once('listening', resolve));
const address = listener.address() as any;
const base = `http://127.0.0.1:${address.port}`;
try {
  const settings = await (await fetch(`${base}/api/store-settings`)).json();
  assert.equal(catalogReads, 0, 'settings must not read the catalog');
  assert.equal(settings.storeSettings.orders_telegramBotToken, undefined);
  assert.equal(settings.storeSettings.orders_telegramChatId, undefined);
  for (const id of ['1', 'argan', 'argan-oil']) {
    const response = await fetch(`${base}/api/products/${id}`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.product.id, '1');
    assert.equal(body.products, undefined, 'single product response must not include catalog');
  }
  assert.equal((await fetch(`${base}/api/products/missing`)).status, 404);
  assert.equal((await fetch(`${base}/api/products/hidden`)).status, 404);
  const catalog = await (await fetch(`${base}/api/products`)).json();
  assert.equal(catalog.products.length, 2);
  assert.ok(matchesProduct(products[1], 'JOJOBA'));
  console.log('PASS: settings isolation, private settings, single product IDs/slugs, hidden/missing products, catalog compatibility');
} finally { listener.close(); }

// Cold startup must not touch D1/R2 before the first route is known.
process.env.VERCEL = '1';
process.env.CLOUDFLARE_D1_ACCOUNT_ID = 'fixture';
process.env.CLOUDFLARE_D1_DATABASE_ID = 'fixture';
process.env.CLOUDFLARE_D1_API_TOKEN = 'fixture';
const originalFetch = globalThis.fetch;
let startupFetches = 0;
globalThis.fetch = async () => { startupFetches++; throw new Error('Unexpected startup fetch'); };
try {
  const { app } = createRequire(import.meta.url)('../dist/server.cjs');
  const coldServer = (await app).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => coldServer.once('listening', resolve));
  try {
    const address = coldServer.address() as any;
    const response = await originalFetch(`http://127.0.0.1:${address.port}/`);
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes('<div id="root">'));
  } finally { coldServer.close(); }
  assert.equal(startupFetches, 0);
  console.log('PASS: cold startup and home HTML perform zero external data fetches');
} finally { globalThis.fetch = originalFetch; }
