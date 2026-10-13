# Bellaura Oils — loading priority fix v2

This revision fixes the Home product-image delay reported after v1. After the primary Home image loads (or fails), the page warms the collection code, requests the catalog and prepares the first four matching product images before scrolling. The actual collection mounts 1200px before the viewport, starting data and code together. The remaining sections retain the 300px threshold. First-row images use eager/auto priority; subsequent images remain lazy/low. Card opacity/blur entrance animation has been removed. Direct-product isolation is unchanged.

Validated again with TypeScript, the production frontend build and Chromium tests at 390px and 1440px. Tests hold the hero image and delay the collection chunk: no catalog before the hero is released, four product images requested before scrolling, distant images remain lazy, and no hidden-card animation. These are local fixture tests, not live-site speed measurements.


## شنو لقيت

الكود فيه أسباب واضحة كتأخر البداية، وماشي غير موضوع حجم الصور:

- السيرفر كان كيتسنى إعدادات المتجر، الكاتالوغ، البلدان، الكوبونات، المدن، أقسام التنقل، أقسام Home، والتقييمات قبل ما يكون مستعد يجاوب حتى على أول صفحة. أغلب هاد العمليات كانت متتابعة.
- فالمتصفح، `prefetchAppInitialData` و`ProductProvider` و`LanguageProvider` كانوا كيطلقو تحميل الكاتالوغ مباشرة. الكاش كيجمع الطلبات المتزامنة، ولكن ما كيأجلش الطلب غير الضروري.
- صفحة Home كانت كتركب جميع الأقسام وكتطلب عروض اللايف فوراً. `loading="lazy"` فالصور ما كيأجلش تركيب المكونات والطلبات ديالها.
- كود ProductDetail كان داخل فالتحميل المشترك لجميع الصفحات.

## شنو تبدل

- السيرفر ما بقى كيحمّل جميع البيانات عند الإقلاع. كل مسار كيطالب بالبيانات اللي محتاجها.
- أول جوج أقسام فـHome كيبانو مباشرة من بعد وصول إعدادات الصفحة. أول صورة عندها أولوية عالية. الأقسام الأخرى كتتفعّل ملي تقرب بـ300px من الشاشة، ومجموعة المنتجات بـ1200px مع تجهيز أول 4 صور من بعد الصورة الرئيسية.
- كود وبيانات مجموعة المنتجات كيتوجدو من بعد الصورة الرئيسية أو عند الاقتراب، وعروض اللايف كتبقى كتتحمّل عند الاقتراب.
- إعدادات المتجر واللغة ولات فطلب مستقل، بلا تنزيل الكاتالوغ.
- صفحة المنتوج ولات منفصلة فالكود. `/api/products/:id` كيرجع منتوج واحد للمتصفح، وكيقبل ID وslug والاسم المحول لرابط.
- فالدخول المباشر، السيرفر كيقدر يحط بيانات المنتوج فـHTML، والكاش ديال الواجهة كيستعملها بلا إعادة نفس الطلب فوراً.
- الكاتالوغ كيتحمّل بعد الصورة الرئيسية فالـHome اللي فيها مجموعة منتجات، أو عند الحاجة: مجموعة ظاهرة، صفحة المنتجات، فتح السلة، checkout، أو صفحة كتحتاج أسماء المنتجات.
- تصلح تسرب المنتوج الأول أثناء الانتقال لمنتوج آخر، وتم التفريق بين منتوج غير موجود وتعذر الاتصال.
- تصلح خطأ موجود سابقاً فحساب تخفيض بعض أحجام المنتوج، مع استيرادات الأنواع الناقصة.

## التركيب

استعمل `StoreFrontBellauraOils-home-images-v2.zip` كمصدر المشروع المعدل. خاص الواجهة وAPI يتنشرو بجوج فنفس النشر، حيث الواجهة ولات كتستعمل مسارات جديدة.

1. فك الضغط، وانقل المصدر للمشروع ديالك.
2. احتفظ بإعدادات البيئة الموجودة فالاستضافة؛ ملف ZIP ما فيهش أسرار الإنتاج.
3. شغّل `npm ci` ثم `npm run build`، وانشر بالطريقة المعتادة ديالك على Vercel.

الموقع الحي ما تبدلش؛ هادي نسخة مصدر معدلة، ماشي نشر مباشر.

## Verification / developer handoff

Passed locally:

- TypeScript check: `npm run lint`.
- Production frontend bundle, backend bundle, and HTML postbuild step.
- `node --import tsx scripts/test-loading-api.ts`: independent settings endpoint, private-setting filtering, product ID/slug/name matching, missing and hidden products, catalog compatibility, and zero external fetches during cold boot and home HTML delivery.
- `node scripts/test-loading-browser.mjs`: Chromium with mocked APIs, at 390×844 and 1440×900. Confirmed no catalog requests while the hero is held; the first four collection image requests start after the hero finishes and before scrolling. No initial live-pack request or ProductDetail chunk on home. Other sections activate on scroll.
- Direct product route: no homepage API/chunk or full catalog request; size discounts render; product A→B navigation does not show A as B; missing products, connection errors, and subsequent home/catalog navigation work without browser exceptions.

To reproduce: install dependencies, build, run the API test; run `npx playwright install chromium` before the browser test. The optional `BROWSER_EXECUTABLE` environment variable selects an existing compatible Chromium binary.

This Windows sandbox denied Vite's filesystem realpath operation. The frontend was therefore built using Vite's normal API with the **local-only** override `resolve.preserveSymlinks: true`; the shipped Vite configuration was not changed. Backend and postbuild commands ran normally.

## Limits and what to measure after deployment

- No live D1/R2 credentials or production timing trace were supplied. These tests validate request ordering and behavior, not a promised LCP/TTFB improvement in seconds.
- The existing D1 product reader still retrieves the catalog internally to resolve products and legacy name-based slugs. The browser receives just the selected product; this change does **not** claim to implement a single-row database query. A large catalog or slow schema/SEO lookups can still affect direct-product TTFB.
- The homepage layout configuration still arrives as one JSON response. Other distant sections and live-pack requests are deferred. The Home collection catalog and first four images are prepared after the primary image; the carousel itself still mounts near the viewport.
- Placeholder heights for distant sections are estimates; verify scrolling with the real admin-configured layout. Browsers without IntersectionObserver fall back to rendering all sections.
- Compare a fresh Home visit and a fresh direct-product visit on a throttled mobile connection after deployment. Check TTFB and LCP separately. Validate real cart/checkout and live-pack data in the deployed environment.

The archive includes the full source, a dependency lockfile and the two regression scripts. It excludes node_modules, build output, downloaded test browsers and temporary working files.
