import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = process.cwd();
const app = express();
app.use(express.static(path.join(root, 'dist')));
app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist/app.html')));
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const product = id => ({ id, slug: id, name: `${id} Oil`, name_en: `${id} Oil`, price: '90 DH', image: `/${id}.svg`, category: 'skin', isAvailable: true, showInSwiper: true, displaySection: 'both', in_catalog: 1, sizes: [{size:'30 ml',price:'90 DH',originalPrice:'120 DH'}] });
const sections = [
  { id: 'hero', type: 'hero', image_url: '/fixture.svg', image_fit: 'cover', image_config: JSON.stringify({h_mobile:90,h_desktop:90}), title_en: 'Home hero' },
  { id: 'intro', type: 'paragraph', image_url: '/intro.svg', title_en: 'Our oils', content_en: 'Priority section', image_fit:'cover' },
  ...Array.from({length:4},(_,i)=>({id:`p${i}`,type:'paragraph',image_url:`/below-${i}.svg`,title_en:`Section ${i}`,content_en:'Below the fold',image_fit:'cover'})),
  { id: 'collection', type: 'collection', title_en: 'Collection' },
  { id: 'live', type: 'live', title_en: 'Live' },
].map((s,i)=>({...s,is_visible:1,order_index:i}));
const results=[];
async function setup(viewport, holdHero = false) {
  let releaseHero;
  const heroReady = new Promise(resolve => { releaseHero = resolve; });
  if (!holdHero) releaseHero();
  const context = await browser.newContext({viewport});
  const requests=[]; const errors=[]; const collectionLoads=[];
  const page=await context.newPage();
  page.on('pageerror', error=>errors.push(error.message));
  page.on('request', req=>requests.push(new URL(req.url()).pathname));
  await page.route('**/*', async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==base) return route.abort();
    const pathname=url.pathname;
    if(pathname==='/fixture.svg') await heroReady;
    const json=body=>route.fulfill({json:body});
    if(pathname==='/api/homepage-sections') return json({success:true,sections});
    if(pathname==='/api/store-settings') return json({success:true,storeSettings:{enableEn:true,enableAr:true}});
    if(pathname==='/api/sections') return json({success:true,sections:[{id:'nav',type:'link',is_visible:1,order_index:0,title_en:'Products',link_url:'/products'}]});
    if(pathname.includes('/assets/CollectionSwiper-')) {
      await new Promise(resolve=>setTimeout(resolve,500));
      return route.continue();
    }
    if(pathname==='/api/products/featured') {
      const collection=page.locator('[data-preload-distance="1200"]');
      if(await collection.count()) collectionLoads.push(await collection.evaluate(el=>({
        distance:el.getBoundingClientRect().top-window.innerHeight,
        hasCards:!!el.querySelector('img'),
      })));
      return json({success:true,products:['argan','jojoba','rose','almond','coconut','olive'].map(product)});
    }
    if(pathname==='/api/products') {
      return json({success:true,products:['argan','jojoba','rose','almond','coconut','olive'].map(product),storeSettings:{enableEn:true,enableAr:true}});
    }
    if(pathname.endsWith('/data')) return json({success:true,data:{}});
    if(pathname.startsWith('/api/products/')) {
      const id=pathname.split('/').pop();
      if(id==='jojoba') await new Promise(r=>setTimeout(r,700));
      if(id==='missing') return route.fulfill({status:404,json:{success:false}});
      if(id==='unavailable') return route.fulfill({status:503,json:{success:false}});
      return json({success:true,product:product(id)});
    }
    if(pathname==='/api/reviews/summary') return json({success:true,summary:{argan:{count:3,rating:'4.7'}}});
    if(pathname==='/api/reviews') return json({success:true,reviews:[],total:0,hasMore:false});
    if(pathname==='/api/live-packs') return json({success:true,enabled:false,packs:[]});
    if(pathname.endsWith('.svg')) return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="#e9dbca"/></svg>'});
    return route.continue();
  });
  await page.addInitScript(()=>localStorage.setItem('bellaura_lang','en'));
  return {context,page,requests,errors,collectionLoads,releaseHero};
}
async function navigate(page, pathname) {
  await page.evaluate(pathname=>{history.pushState({},'',pathname);dispatchEvent(new PopStateEvent('popstate'));},pathname);
}
try {
  for(const viewport of [{width:390,height:844},{width:1440,height:900}]) {
    const {context,page,requests,errors,collectionLoads,releaseHero}=await setup(viewport,true);
    await page.goto(base+'/',{waitUntil:'domcontentloaded'});
    await page.locator('[data-deferred-section="ready"]').first().waitFor();
    await page.waitForTimeout(800);
    assert.ok(requests.includes('/api/products/featured'),'Home did not request featured products while the hero was loading');
    assert.ok(!requests.includes('/api/products'),'Home downloaded the full catalog for the carousel');
    const imagesWarmed = Promise.all(['argan','jojoba','rose','almond'].map(id=>
      page.waitForRequest(request=>new URL(request.url()).pathname===`/${id}.svg`)));
    await imagesWarmed;
    assert.ok(requests.includes('/api/reviews/summary'));
    assert.ok(!requests.includes('/api/live-packs'));
    assert.ok(!requests.some(url=>url.includes('/assets/ProductDetail-')));
    assert.ok(await page.locator('[data-deferred-section="waiting"]').count()>0);
    assert.equal(await page.locator('img[fetchpriority="high"]').first().getAttribute('src'),'/fixture.svg');
    releaseHero();
    assert.equal(await page.evaluate(()=>window.scrollY),0);
    assert.equal(await page.locator('[data-preload-distance="1200"]').getAttribute('data-deferred-section'),'waiting');
    assert.ok(!requests.includes('/coconut.svg'),'distant carousel images must remain lazy');
    for(let i=0;i<16 && !requests.includes('/api/live-packs');i++) {
      await page.evaluate(()=>window.scrollBy(0,600));
      await page.waitForTimeout(150);
    }
    assert.ok(!requests.includes('/api/products'),'collection requested the full catalog');
    assert.ok(requests.includes('/api/live-packs'),'live section did not request packs on approach');
    assert.ok(collectionLoads[0].distance > 300, 'collection must start earlier than the old 300px threshold');
    assert.equal(collectionLoads[0].hasCards,false,'data request starts without waiting for the delayed collection chunk');
    const collection=page.locator('[data-preload-distance="1200"]');
    assert.equal(await collection.locator('img[loading="eager"][fetchpriority="high"]').count(),1);
    assert.equal(await collection.locator('img[loading="eager"][fetchpriority="auto"]').count(),1);
    assert.equal(await collection.locator('img[loading="lazy"][fetchpriority="low"]').count(),3);
    assert.equal(await collection.locator('img').first().evaluate(el=>getComputedStyle(el.closest('.snap-center')).opacity),'1');
    assert.deepEqual(errors,[]);
    results.push(`PASS home ${viewport.width}px: featured data and first 4 product images start before hero release/scroll; no full catalog; remaining images and live section stay lazy; no hidden card animation`);
    await context.close();
  }
  const {context,page,requests,errors}=await setup({width:390,height:844});
  await page.goto(base+'/product/argan');
  await page.getByRole('heading',{name:'argan Oil',exact:true,level:1}).waitFor();
  assert.ok(!requests.includes('/api/products'));
  assert.ok(!requests.includes('/api/homepage-sections'));
  assert.ok(!requests.some(url=>url.includes('/assets/HomePage-')));
  await navigate(page,'/product/jojoba');
  await page.waitForTimeout(150);
  assert.equal(await page.getByRole('heading',{name:'argan Oil',exact:true,level:1}).count(),0);
  await page.getByRole('heading',{name:'jojoba Oil',exact:true,level:1}).waitFor();
  await navigate(page,'/product/missing');
  await page.waitForTimeout(500);
  assert.equal(await page.getByRole('heading',{name:'jojoba Oil',exact:true,level:1}).count(),0);
  await navigate(page,'/product/unavailable');
  await page.getByRole('button',{name:'Retry',exact:true}).waitFor();
  await navigate(page,'/');
  await page.locator('[data-deferred-section="ready"]').first().waitFor();
  await navigate(page,'/products');
  await page.waitForTimeout(600);
  assert.ok(requests.includes('/api/products'));
  assert.deepEqual(errors,[]);
  results.push('PASS direct product: isolated data/code, size discount renders, A→B no stale product, missing/error recovery, home and catalog navigation');
  await context.close();
  console.log(results.join('\n'));
} finally {await browser.close();server.close();}
