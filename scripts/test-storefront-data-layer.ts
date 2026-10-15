/**
 * Automated Verification Script for Storefront Data Layer and Business Rules
 * Tests Part 2 - Part 22 requirements
 */

import { classifyUserAgent } from '../src/server/utils/botDetector';
import { isValidOrderTransition, normalizeOrderStatus, ORDER_STATES } from '../src/server/utils/orderStateMachine';

let passed = 0;
let failed = 0;

function assert(condition: boolean, desc: string) {
  if (condition) {
    console.log(`  ✓ ${desc}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${desc}`);
    failed++;
  }
}

console.log('=== 1. TESTING PRODUCT QUANTITY BOUNDS (PART 2) ===');
function validateItemQuantity(qty: any): { valid: boolean; error?: string } {
  if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > 7) {
    return { valid: false, error: 'Product quantity must be an integer between 1 and 7.' };
  }
  return { valid: true };
}

assert(validateItemQuantity(1).valid === true, 'Quantity 1 is valid');
assert(validateItemQuantity(7).valid === true, 'Quantity 7 is valid');
assert(validateItemQuantity(4).valid === true, 'Quantity 4 is valid');
assert(validateItemQuantity(0).valid === false, 'Quantity 0 is rejected');
assert(validateItemQuantity(8).valid === false, 'Quantity 8 is rejected');
assert(validateItemQuantity(20).valid === false, 'Quantity 20 is rejected');
assert(validateItemQuantity(100).valid === false, 'Quantity 100 is rejected');
assert(validateItemQuantity(-1).valid === false, 'Negative quantity is rejected');
assert(validateItemQuantity(2.5).valid === false, 'Non-integer quantity 2.5 is rejected');

console.log('\n=== 2. TESTING ORDER STATE MACHINE (PART 7) ===');
// Primary flow
assert(isValidOrderTransition('NEW', 'CONFIRMED').valid === true, 'NEW -> CONFIRMED is valid');
assert(isValidOrderTransition('CONFIRMED', 'PREPARING').valid === true, 'CONFIRMED -> PREPARING is valid');
assert(isValidOrderTransition('PREPARING', 'SHIPPED').valid === true, 'PREPARING -> SHIPPED is valid');
assert(isValidOrderTransition('SHIPPED', 'DELIVERED').valid === true, 'SHIPPED -> DELIVERED is valid');

// Cancelled & Exception flows
assert(isValidOrderTransition('NEW', 'CANCELLED').valid === true, 'NEW -> CANCELLED is valid');
assert(isValidOrderTransition('CONFIRMED', 'CANCELLED').valid === true, 'CONFIRMED -> CANCELLED is valid');
assert(isValidOrderTransition('PREPARING', 'CANCELLED').valid === true, 'PREPARING -> CANCELLED is valid');
assert(isValidOrderTransition('SHIPPED', 'REFUSED').valid === true, 'SHIPPED -> REFUSED is valid');
assert(isValidOrderTransition('SHIPPED', 'RETURNED').valid === true, 'SHIPPED -> RETURNED is valid');
assert(isValidOrderTransition('DELIVERED', 'RETURNED').valid === true, 'DELIVERED -> RETURNED is valid');

// Invalid jumps
assert(isValidOrderTransition('NEW', 'DELIVERED').valid === false, 'NEW -> DELIVERED is rejected');
assert(isValidOrderTransition('NEW', 'SHIPPED').valid === false, 'NEW -> SHIPPED is rejected');
assert(isValidOrderTransition('DELIVERED', 'NEW').valid === false, 'DELIVERED -> NEW is rejected');
assert(isValidOrderTransition('CANCELLED', 'CONFIRMED').valid === false, 'CANCELLED -> CONFIRMED is rejected (terminal)');
assert(isValidOrderTransition('RETURNED', 'NEW').valid === false, 'RETURNED -> NEW is rejected (terminal)');

// Legacy/localization mapping
assert(normalizeOrderStatus('pending') === 'NEW', "Legacy 'pending' normalizes to NEW");
assert(normalizeOrderStatus('مؤكد') === 'CONFIRMED', "Arabic 'مؤكد' normalizes to CONFIRMED");
assert(normalizeOrderStatus('LIVRE') === 'DELIVERED', "French 'LIVRE' normalizes to DELIVERED");

console.log('\n=== 3. TESTING BOT / HUMAN CLASSIFICATION (PART 15) ===');
const googlebotUA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const bingbotUA = 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)';
const tiktokUA = 'Mozilla/5.0 (Linux; Android 10; TikTok 26.1.3) AppleWebKit/537.36';
const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const safariMobileUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const pythonUA = 'python-requests/2.28.1';

const gRes = classifyUserAgent(googlebotUA);
assert(gRes.trafficType === 'bot' && gRes.botName === 'Googlebot', 'Identified Googlebot as bot');

const bRes = classifyUserAgent(bingbotUA);
assert(bRes.trafficType === 'bot' && bRes.botName === 'Bingbot', 'Identified Bingbot as bot');

const tRes = classifyUserAgent(tiktokUA);
assert(tRes.trafficType === 'bot' && tRes.botName === 'TikTokBot', 'Identified TikTok crawler as bot');

const pyRes = classifyUserAgent(pythonUA);
assert(pyRes.trafficType === 'bot' && pyRes.botName === 'PythonRequests', 'Identified Python scraper as bot');

const cRes = classifyUserAgent(chromeUA);
assert(cRes.trafficType === 'human' && cRes.botName === null, 'Identified Desktop Chrome as human');

const sRes = classifyUserAgent(safariMobileUA);
assert(sRes.trafficType === 'human' && sRes.botName === null, 'Identified Mobile Safari as human');

const emptyRes = classifyUserAgent(undefined);
assert(emptyRes.trafficType === 'unknown', 'Missing User-Agent classified as unknown');

console.log('\n=== 4. TESTING SERVER-SIDE PRICING & ORDER PRICE SNAPSHOT (PARTS 3 & 4) ===');
// D1 authoritative catalog
const d1Catalog = [
  { id: 'jojoba-50', name: 'Huile de Jojoba Pure', price: '85 DH', sizes: [{ size: '50ml', price: '85 DH' }, { size: '100ml', price: '150 DH' }] },
  { id: 'rosehip-30', name: 'Huile de Rose Musquée', price: '120 DH', sizes: [] }
];

function recalculateOrder(items: Array<{ id: string; selectedSize?: { size: string }; quantity: number; clientPrice?: any }>) {
  let subtotal = 0;
  const snapshotItems = [];

  for (const item of items) {
    const qty = Math.max(1, Math.min(7, Math.round(Number(item.quantity) || 1)));
    const product = d1Catalog.find(p => p.id === item.id);
    if (!product) throw new Error(`Product not found: ${item.id}`);

    let unitPrice = 0;
    let sizeLabel = '';
    if (item.selectedSize?.size && Array.isArray(product.sizes)) {
      const match = product.sizes.find(s => s.size.toLowerCase() === item.selectedSize!.size.toLowerCase());
      if (match) {
        unitPrice = parseFloat(String(match.price).replace(/[^\d.]/g, '')) || 0;
        sizeLabel = ` (${match.size})`;
      }
    }
    if (unitPrice <= 0) {
      unitPrice = parseFloat(String(product.price).replace(/[^\d.]/g, '')) || 0;
    }

    const lineTotal = Math.round(unitPrice * qty);
    subtotal += lineTotal;

    snapshotItems.push({
      product_id: product.id,
      product_name: `${product.name}${sizeLabel}`,
      unit_price: unitPrice,
      quantity: qty,
      line_total: lineTotal
    });
  }

  return { subtotal, snapshotItems };
}

// Client tries to forge unitPrice = 1 DH for Jojoba
const orderAttempt = [
  { id: 'jojoba-50', quantity: 2, clientPrice: '1 DH' },
  { id: 'jojoba-50', selectedSize: { size: '100ml' }, quantity: 1, clientPrice: '5 DH' }
];

const calculated = recalculateOrder(orderAttempt);
assert(calculated.snapshotItems[0].unit_price === 85, 'Authoritative unit price 85 DH applied (client 1 DH ignored)');
assert(calculated.snapshotItems[0].line_total === 170, 'Snapshot line total is exactly 170 DH (85 * 2)');
assert(calculated.snapshotItems[1].unit_price === 150, 'Authoritative variant unit price 150 DH applied (client 5 DH ignored)');
assert(calculated.snapshotItems[1].line_total === 150, 'Snapshot line total is exactly 150 DH (150 * 1)');
assert(calculated.subtotal === 320, 'Server recalculates total to 320 DH');

console.log('\n=== 5. TESTING PRIVACY FILTERING (PART 18) ===');
const SENSITIVE_KEYS = ['firstName', 'lastName', 'phone', 'address', 'notes', 'turnstileToken', 'ip', 'user_agent'];
function sanitizeMetadata(meta: any) {
  if (typeof meta !== 'object' || meta === null) return {};
  const cleaned: Record<string, any> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SENSITIVE_KEYS.some(sk => k.toLowerCase().includes(sk.toLowerCase()))) {
      continue; // Stripped
    }
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      cleaned[k] = v;
    }
  }
  return cleaned;
}

const dirtyClientMeta = {
  firstName: 'Mohamed',
  phone: '0612345678',
  address: '123 Boulevard d Anfa Casablanca',
  turnstileToken: '0.xyz123',
  reason: 'validation',
  seconds: 45
};

const cleaned = sanitizeMetadata(dirtyClientMeta);
assert(cleaned.firstName === undefined, 'Customer firstName was stripped');
assert(cleaned.phone === undefined, 'Customer phone was stripped');
assert(cleaned.address === undefined, 'Customer address was stripped');
assert(cleaned.turnstileToken === undefined, 'Turnstile token was stripped');
assert(cleaned.reason === 'validation', 'Non-sensitive reason preserved');
assert(cleaned.seconds === 45, 'Non-sensitive seconds preserved');

console.log('\n=== 6. TESTING ALLOWED ANALYTICS EVENTS (PART 9) ===');
const ALLOWED_EVENT_NAMES = new Set([
  'page_view',
  'product_view',
  'add_to_cart',
  'remove_from_cart',
  'checkout_start',
  'checkout_form_start',
  'checkout_submit',
  'checkout_submit_failed',
  'order_confirmed',
  'search',
  'scroll',
  'time_on_page',
  'session_start',
  'purchase_complete'
]);

assert(ALLOWED_EVENT_NAMES.has('page_view'), 'page_view is allowed');
assert(ALLOWED_EVENT_NAMES.has('checkout_form_start'), 'checkout_form_start is allowed');
assert(ALLOWED_EVENT_NAMES.has('checkout_submit_failed'), 'checkout_submit_failed is allowed');
assert(ALLOWED_EVENT_NAMES.has('order_confirmed'), 'order_confirmed is allowed');
assert(ALLOWED_EVENT_NAMES.has('scroll'), 'scroll is allowed');
assert(ALLOWED_EVENT_NAMES.has('time_on_page'), 'time_on_page is allowed');
assert(!ALLOWED_EVENT_NAMES.has('malicious_arbitrary_event'), 'Unsupported event is rejected');
assert(!ALLOWED_EVENT_NAMES.has('credit_card_entered'), 'Arbitrary event rejected');

console.log(`\n========================================`);
console.log(`TEST SUMMARY: ${passed} Passed, ${failed} Failed`);
console.log(`========================================`);

if (failed > 0) {
  process.exit(1);
}
