/**
 * Lightweight First-Party Storefront Analytics Tracker for BellAura Oils
 *
 * - Zero external analytics SDKs or heavy dependencies (< 2.5 KB minified)
 * - Pure first-party: sends events directly to /api/analytics/collect
 * - Pseudonymous: visitor_id (localStorage UUID) & session_id (30-min inactivity window)
 * - Multi-tab aware: shares session across active tabs via localStorage & storage events
 * - Active engagement measurement via Page Visibility API (pauses when hidden/backgrounded)
 * - Non-blocking, fails open: tracking failures NEVER disrupt storefront, cart, or checkout
 * - No fingerprinting, no keystroke tracking, no cursor tracking, no raw IP storage
 */

export type AnalyticsEventType =
  | 'session_start'
  | 'page_view'
  | 'product_view'
  | 'add_to_cart'
  | 'remove_from_cart'
  | 'cart_view'
  | 'checkout_start'
  | 'purchase_complete';

export interface TrackingEventPayload {
  eventName: AnalyticsEventType;
  path?: string;
  productId?: string;
  productName?: string;
  quantity?: number;
  unitPrice?: number;
  activeDurationMs?: number;
  metadata?: Record<string, any>;
}

const STORAGE_KEY_VISITOR_ID = 'bellaura_visitor_id';
const STORAGE_KEY_SESSION_ID = 'bellaura_session_id';
const STORAGE_KEY_LAST_ACTIVE = 'bellaura_session_last_active';
const STORAGE_KEY_FIRST_TOUCH_SOURCE = 'bellaura_first_touch_source';
const STORAGE_KEY_FIRST_LANDING = 'bellaura_first_landing_page';
const STORAGE_KEY_SESSION_LANDING = 'bellaura_session_landing_page';
const STORAGE_KEY_CURRENT_SOURCE = 'bellaura_session_source';
const STORAGE_KEY_CURRENT_CAMPAIGN = 'bellaura_utm_campaign';
const STORAGE_KEY_SESSION_ATTRIBUTION = 'bellaura_session_attribution';

const SESSION_INACTIVITY_LIMIT_MS = 30 * 60 * 1000; // 30 minutes
const MAX_BATCH_SIZE = 8;
const FLUSH_INTERVAL_MS = 10 * 1000; // 10 seconds

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Classify traffic acquisition into recognizable channels:
 * TikTok, Instagram, Facebook, Google, YouTube, WhatsApp, Direct, Other
 */
function classifyTrafficSource(url: URL, referrerStr: string): { source: string; utms: Record<string, string> } {
  const params = url.searchParams;
  const utmSource = (params.get('utm_source') || '').toLowerCase().trim();
  const utmMedium = (params.get('utm_medium') || '').toLowerCase().trim();
  const utmCampaign = (params.get('utm_campaign') || '').trim();
  const utmContent = (params.get('utm_content') || '').trim();
  const utmTerm = (params.get('utm_term') || '').trim();

  const utms: Record<string, string> = {};
  if (utmSource) utms.utm_source = utmSource;
  if (utmMedium) utms.utm_medium = utmMedium;
  if (utmCampaign) utms.utm_campaign = utmCampaign;
  if (utmContent) utms.utm_content = utmContent;
  if (utmTerm) utms.utm_term = utmTerm;

  // 1. Explicit UTM Priority
  const sourceTokens = utmSource.split(/[^a-z0-9]+/).filter(Boolean);
  if (sourceTokens.includes('tiktok')) return { source: 'TikTok', utms };
  if (sourceTokens.some(token => ['instagram', 'ig'].includes(token))) return { source: 'Instagram', utms };
  if (sourceTokens.some(token => ['facebook', 'fb', 'meta'].includes(token))) return { source: 'Facebook', utms };
  if (sourceTokens.includes('google')) return { source: 'Google', utms };
  if (sourceTokens.includes('youtube') || sourceTokens.includes('youtu')) return { source: 'YouTube', utms };
  if (sourceTokens.some(token => ['whatsapp', 'wa'].includes(token))) return { source: 'WhatsApp', utms };

  // 2. Recognizable External Referrer Priority
  if (referrerStr) {
    try {
      const refHost = new URL(referrerStr).hostname.toLowerCase();
      const isDomain = (domain: string) => refHost === domain || refHost.endsWith(`.${domain}`);
      if (isDomain('tiktok.com')) return { source: 'TikTok', utms };
      if (isDomain('instagram.com')) return { source: 'Instagram', utms };
      if (isDomain('facebook.com') || isDomain('fb.me') || isDomain('messenger.com')) return { source: 'Facebook', utms };
      if (isDomain('google.com') || /^google\.[a-z.]+$/.test(refHost)) return { source: 'Google', utms };
      if (isDomain('youtube.com') || isDomain('youtu.be')) return { source: 'YouTube', utms };
      if (isDomain('whatsapp.com') || isDomain('wa.me')) return { source: 'WhatsApp', utms };

      // Self-referrer or internal navigation is considered Direct continuation
      const currentHost = window.location.hostname.toLowerCase().replace(/^www\./, '');
      if (refHost.replace(/^www\./, '') === currentHost) {
        return { source: 'Direct', utms };
      }
      return { source: 'Other', utms };
    } catch {
      // Malformed referrer
    }
  }

  return { source: 'Direct', utms };
}

class StorefrontTracker {
  private visitorId: string = '';
  private sessionId: string = '';
  private sessionSource: string = 'Direct';
  private utmParams: Record<string, string> = {};
  private eventQueue: Array<TrackingEventPayload & { createdAt: string }> = [];
  private flushTimer: any = null;
  private isInitialised = false;

  // Active page visibility timer
  private activeStartTime: number = Date.now();
  private accumulatedActiveMs: number = 0;
  private isPageVisible: boolean = true;
  private currentPath: string = '';

  public init(): void {
    if (typeof window === 'undefined' || this.isInitialised) return;
    this.isInitialised = true;

    try {
      this.currentPath = window.location.pathname;
      this.resolveVisitorAndSession();
      this.setupVisibilityListeners();
      this.setupUnloadListeners();

      // Start background flush loop
      this.flushTimer = setInterval(() => {
        this.flush();
      }, FLUSH_INTERVAL_MS);
    } catch (e) {
      // Fail open silently
      console.warn('[Tracker] Initialization failed safely:', e);
    }
  }

  private resolveVisitorAndSession(): void {
    const now = Date.now();

    // 1. Visitor ID (Persistent across browser restarts)
    let vId = localStorage.getItem(STORAGE_KEY_VISITOR_ID);
    if (!vId) {
      vId = generateUUID();
      try {
        localStorage.setItem(STORAGE_KEY_VISITOR_ID, vId);
      } catch {}
    }
    this.visitorId = vId;

    // 2. Determine whether this is a new session before resolving attribution.
    const existingSessionId = localStorage.getItem(STORAGE_KEY_SESSION_ID);
    const lastActiveStr = localStorage.getItem(STORAGE_KEY_LAST_ACTIVE);
    const lastActive = lastActiveStr ? parseInt(lastActiveStr, 10) : 0;
    const isSessionExpired = !existingSessionId || !Number.isFinite(lastActive) ||
      now - lastActive > SESSION_INACTIVITY_LIMIT_MS;

    // 3. Acquisition & Source Classification. A direct/self-referral visit
    // during an active session must not overwrite its original campaign.
    const currentUrl = new URL(window.location.href);
    const referrerStr = document.referrer || '';
    const classified = classifyTrafficSource(currentUrl, referrerStr);
    if (isSessionExpired) {
      this.sessionSource = classified.source;
      this.utmParams = classified.utms;
    } else {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_SESSION_ATTRIBUTION) || 'null');
        this.sessionSource = typeof saved?.source === 'string'
          ? saved.source
          : localStorage.getItem(STORAGE_KEY_CURRENT_SOURCE) || 'Direct';
        this.utmParams = saved?.utms && typeof saved.utms === 'object'
          ? saved.utms
          : (localStorage.getItem(STORAGE_KEY_CURRENT_CAMPAIGN)
            ? { utm_campaign: localStorage.getItem(STORAGE_KEY_CURRENT_CAMPAIGN)! }
            : {});
      } catch {
        this.sessionSource = localStorage.getItem(STORAGE_KEY_CURRENT_SOURCE) || 'Direct';
        this.utmParams = {};
      }
    }

    // Record First Touch if absent
    if (!localStorage.getItem(STORAGE_KEY_FIRST_TOUCH_SOURCE)) {
      try {
        localStorage.setItem(STORAGE_KEY_FIRST_TOUCH_SOURCE, classified.source);
        localStorage.setItem(STORAGE_KEY_FIRST_LANDING, window.location.pathname);
      } catch {}
    }

    // 4. Session ID (30 min inactivity boundary, shared across tabs)
    if (isSessionExpired) {
      this.sessionId = generateUUID();
      try {
        localStorage.setItem(STORAGE_KEY_SESSION_ID, this.sessionId);
        localStorage.setItem(STORAGE_KEY_LAST_ACTIVE, String(now));
        localStorage.setItem(STORAGE_KEY_SESSION_LANDING, window.location.pathname);
        localStorage.setItem(STORAGE_KEY_CURRENT_SOURCE, this.sessionSource);
        localStorage.setItem(STORAGE_KEY_SESSION_ATTRIBUTION, JSON.stringify({ source: this.sessionSource, utms: this.utmParams }));
        if (this.utmParams.utm_campaign) localStorage.setItem(STORAGE_KEY_CURRENT_CAMPAIGN, this.utmParams.utm_campaign);
        else localStorage.removeItem(STORAGE_KEY_CURRENT_CAMPAIGN);
      } catch {}

      // New session detected -> emit session_start
      this.track('session_start', {
        path: window.location.pathname,
        metadata: {
          landingPage: window.location.pathname,
          referrer: referrerStr ? referrerStr.substring(0, 200) : null,
          source: this.sessionSource,
          firstTouchSource: localStorage.getItem(STORAGE_KEY_FIRST_TOUCH_SOURCE) || 'Direct',
          ...this.utmParams,
        },
      });
    } else {
      this.sessionId = existingSessionId;
      try {
        localStorage.setItem(STORAGE_KEY_LAST_ACTIVE, String(now));
      } catch {}
    }

    // Listen for storage updates from other tabs to keep session synchronized
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY_SESSION_ID && e.newValue) {
        this.sessionId = e.newValue;
        try {
          const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_SESSION_ATTRIBUTION) || 'null');
          if (typeof saved?.source === 'string') this.sessionSource = saved.source;
          if (saved?.utms && typeof saved.utms === 'object') this.utmParams = saved.utms;
        } catch {}
      }
      if (e.key === STORAGE_KEY_SESSION_ATTRIBUTION && e.newValue) {
        try {
          const saved = JSON.parse(e.newValue);
          if (typeof saved?.source === 'string') this.sessionSource = saved.source;
          if (saved?.utms && typeof saved.utms === 'object') this.utmParams = saved.utms;
        } catch {}
      }
    });
  }

  private setupVisibilityListeners(): void {
    this.isPageVisible = document.visibilityState === 'visible';
    this.activeStartTime = Date.now();

    document.addEventListener('visibilitychange', () => {
      const now = Date.now();
      if (document.visibilityState === 'visible') {
        this.isPageVisible = true;
        this.activeStartTime = now;
      } else {
        // Tab hidden -> accumulate elapsed visible duration
        if (this.isPageVisible) {
          this.accumulatedActiveMs += Math.max(0, now - this.activeStartTime);
        }
        this.isPageVisible = false;
        this.touchSessionActivity();
      }
    });

    window.addEventListener('focus', () => {
      if (document.visibilityState === 'visible' && !this.isPageVisible) {
        this.isPageVisible = true;
        this.activeStartTime = Date.now();
      }
    });

    window.addEventListener('blur', () => {
      if (this.isPageVisible) {
        this.accumulatedActiveMs += Math.max(0, Date.now() - this.activeStartTime);
        this.isPageVisible = false;
      }
    });
  }

  private setupUnloadListeners(): void {
    const handleExit = () => {
      this.touchSessionActivity();
      this.flush(true);
    };

    window.addEventListener('pagehide', handleExit);
    window.addEventListener('beforeunload', handleExit);
  }

  private touchSessionActivity(): void {
    try {
      localStorage.setItem(STORAGE_KEY_LAST_ACTIVE, String(Date.now()));
    } catch {}
  }

  /**
   * Reset active engagement timer on SPA route change and return accumulated time
   */
  public getAndResetActiveDuration(): number {
    const now = Date.now();
    if (this.isPageVisible) {
      this.accumulatedActiveMs += Math.max(0, now - this.activeStartTime);
      this.activeStartTime = now;
    }
    const duration = this.accumulatedActiveMs;
    this.accumulatedActiveMs = 0;
    return duration;
  }

  public track(eventName: AnalyticsEventType, data: Omit<TrackingEventPayload, 'eventName'> = {}): void {
    try {
      this.touchSessionActivity();

      const activeDurationMs = data.activeDurationMs ?? (eventName === 'page_view' ? this.getAndResetActiveDuration() : 0);

      const eventItem = {
        eventName,
        path: data.path || window.location.pathname,
        productId: data.productId,
        productName: data.productName,
        quantity: data.quantity,
        unitPrice: data.unitPrice,
        activeDurationMs,
        metadata: data.metadata,
        createdAt: new Date().toISOString(),
      };

      this.eventQueue.push(eventItem);

      // Immediate flush on important journey moments or when batch reaches threshold
      const isUrgent = eventName === 'checkout_start' || eventName === 'purchase_complete' || this.eventQueue.length >= MAX_BATCH_SIZE;
      if (isUrgent) {
        this.flush();
      }
    } catch (e) {
      // Fail open
    }
  }

  public flush(isExiting = false): void {
    if (this.eventQueue.length === 0) return;

    const eventsToSend = [...this.eventQueue];
    this.eventQueue = [];

    const payload = {
      visitorId: this.visitorId,
      sessionId: this.sessionId,
      source: this.sessionSource,
      firstTouchSource: localStorage.getItem(STORAGE_KEY_FIRST_TOUCH_SOURCE) || 'Direct',
      landingPage: localStorage.getItem(STORAGE_KEY_SESSION_LANDING) ||
        localStorage.getItem(STORAGE_KEY_FIRST_LANDING) || window.location.pathname,
      utms: this.utmParams,
      events: eventsToSend,
    };

    const payloadJson = JSON.stringify(payload);

    if (isExiting && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        const beaconSuccess = navigator.sendBeacon(
          '/api/analytics/collect',
          new Blob([payloadJson], { type: 'application/json' }),
        );
        if (beaconSuccess) return;
      } catch (e) {
        // Fall back to fetch keepalive
      }
    }

    try {
      fetch('/api/analytics/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payloadJson,
        // These batches are small and must survive a fast route change after
        // checkout_start or purchase_complete has emptied the local queue.
        keepalive: true,
      }).then(async (response) => {
        if (!response.ok) throw new Error('Analytics request failed');
        const result = await response.json().catch(() => null);
        if (result?.success === false) throw new Error('Analytics batch was not accepted');
      }).catch(() => {
        // Keep failed events for the next flush, without blocking shopping.
        this.eventQueue = [...eventsToSend, ...this.eventQueue].slice(-40);
      });
    } catch {
      this.eventQueue = [...eventsToSend, ...this.eventQueue].slice(-40);
    }
  }

  public getVisitorId(): string {
    return this.visitorId || localStorage.getItem(STORAGE_KEY_VISITOR_ID) || '';
  }

  public getSessionId(): string {
    return this.sessionId || localStorage.getItem(STORAGE_KEY_SESSION_ID) || '';
  }
}

export const tracker = new StorefrontTracker();
