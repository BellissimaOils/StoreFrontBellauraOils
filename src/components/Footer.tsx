import { Instagram, Facebook, Youtube, Mail } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useProducts } from '../context/ProductContext';
import { Link } from 'react-router-dom';

/**
 * Footer layout notes:
 *
 * The whole footer used to be a single centered column capped at max-w-3xl
 * (768px) with every block stacked vertically. That reads fine on a phone
 * (which is narrower than 768px, so the column fills the screen), but on a
 * desktop it rendered as a narrow 768px ribbon of centered text floating in
 * the middle of a very wide dark band — tall, sparse, and obviously a mobile
 * layout being stretched onto a large screen.
 *
 * It's now responsive properly: the mobile presentation is preserved (single
 * centered column, same spacing), while at `lg` and up it becomes a
 * two-column footer — brand/about, then contact with the About/FAQ links —
 * inside a wider max-w-7xl container, with the social icons and copyright
 * sharing one centred bottom line. That removes the wasted lateral space and
 * cuts the excess height on desktop.
 *
 * ALL text stays centre-aligned at every breakpoint. The desktop grid exists
 * purely to sit blocks side by side so the footer stays short — it is not
 * used to left/start-align anything. (`lg:items-start` on the grid is the
 * block axis, i.e. it tops-aligns the two columns; it does not affect text
 * alignment.) Because everything is centred, no RTL-specific alignment
 * handling is needed.
 */
export default function Footer() {
  const { t, language } = useLanguage();
  const { storeSettings } = useProducts();

  const getTranslatedSetting = (key: string) => {
    if (!storeSettings) return null;
    if (language === 'ar' && storeSettings[`${key}Ar`]) return storeSettings[`${key}Ar`];
    if (language === 'fr' && storeSettings[`${key}Fr`]) return storeSettings[`${key}Fr`];
    if (language === 'en' && storeSettings[`${key}En`]) return storeSettings[`${key}En`];
    return null;
  };

  const footerAbout = getTranslatedSetting('footerAbout') || t('footer.aboutText');
  const footerRights = getTranslatedSetting('footerRights') || t('footer.rights');

  const formatUrl = (url: string) => {
    if (!url) return '#';
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return `https://${url}`;
    }
    return url;
  };

  const email = storeSettings?.storeEmail || "bellauraoils@gmail.com";
  const phone = storeSettings?.storePhoneNumber || "+212 677-343386";
  const rawPhone = phone.replace(/[^0-9+]/g, '');
  const whatsappUrl = storeSettings?.whatsappUrl || (rawPhone ? `https://wa.me/${rawPhone.replace('+', '')}` : `https://wa.me/212677343386`);
  // A WhatsApp *Channel* (public broadcast) is a different destination from
  // the 1:1 chat link above, and has no sensible fallback — there's no phone
  // number to derive a channel URL from, so this only renders once the admin
  // has actually set one in Settings > Social Media Links.
  const whatsappChannelUrl = storeSettings?.whatsappChannelUrl
    ? formatUrl(storeSettings.whatsappChannelUrl)
    : null;

  const hasAnySocial = Boolean(
    storeSettings?.tiktokUrl ||
    storeSettings?.youtubeUrl ||
    storeSettings?.facebookUrl ||
    storeSettings?.instagramUrl ||
    whatsappChannelUrl,
  );

  const iconClass = "hover:text-accent-gold text-white transition-colors";

  const tiktokIcon = (
    <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.03 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.9-.32-1.98-.23-2.81.36-.54.38-.89.98-1.03 1.63-.14.65-.02 1.34.33 1.91.43.74 1.25 1.23 2.09 1.25.75.02 1.49-.33 1.94-.92.35-.45.54-1.01.55-1.58.02-3.23-.01-6.46.01-9.69z"/>
    </svg>
  );

  // Same glyph used for the WhatsApp "Direct" contact pill above — reused
  // here as a bare icon so it sits in the icon row alongside Instagram/
  // Facebook/YouTube/TikTok, which is where it was actually expected. It was
  // previously only reachable as a text pill in the Contact block, so it
  // never showed up in this row at all.
  // WhatsApp's Status / Updates mark: a ring of arc segments.
  //
  // A Channel is a broadcast feed, and this is the symbol WhatsApp itself uses
  // for that part of the app, so it is the one people recognise for "updates"
  // rather than "message me". The two previous attempts were both the chat logo
  // — first the outline variant, which read as an empty blob at 20px, then the
  // filled one — and a chat bubble is the wrong promise for a link that opens a
  // feed you follow.
  //
  // Drawn as a dashed circle rather than eight separate arc paths.
  // `pathLength="60"` normalises the circumference, so the 4.5-on, 3-off dash
  // pattern divides it into exactly eight even segments regardless of the
  // radius; without it the dash lengths would have to be recomputed from
  // 2πr by hand and would drift if the size ever changed.
  const whatsappIcon = (
    <svg
      className="w-5 h-5"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="12"
        cy="12"
        r="9.25"
        pathLength={60}
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeDasharray="4.5 3"
      />
    </svg>
  );

  // NOTE: when no social URLs are configured this intentionally still falls
  // back to four placeholder href="#" icons, exactly as before. Those are
  // dead links and worth removing, but doing it here would also change the
  // mobile footer — and mobile was reported as already correct — so it's
  // left alone rather than bundled into a desktop layout fix.
  const socialLinks = (
    <>
      {whatsappChannelUrl && (
        <a href={whatsappChannelUrl} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp Channel" className={iconClass}>
          {whatsappIcon}
        </a>
      )}
      {storeSettings?.tiktokUrl && (
        <a href={formatUrl(storeSettings.tiktokUrl)} target="_blank" rel="noopener noreferrer" aria-label="TikTok" className={iconClass}>
          {tiktokIcon}
        </a>
      )}
      {storeSettings?.youtubeUrl && (
        <a href={formatUrl(storeSettings.youtubeUrl)} target="_blank" rel="noopener noreferrer" aria-label="YouTube" className={iconClass}>
          <Youtube className="w-5 h-5 cursor-pointer" />
        </a>
      )}
      {storeSettings?.facebookUrl && (
        <a href={formatUrl(storeSettings.facebookUrl)} target="_blank" rel="noopener noreferrer" aria-label="Facebook" className={iconClass}>
          <Facebook className="w-5 h-5 cursor-pointer" />
        </a>
      )}
      {storeSettings?.instagramUrl && (
        <a href={formatUrl(storeSettings.instagramUrl)} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className={iconClass}>
          <Instagram className="w-5 h-5 cursor-pointer" />
        </a>
      )}

      {!hasAnySocial && (
        <>
          <a href="#" aria-label="TikTok" className={iconClass}>{tiktokIcon}</a>
          <a href="#" aria-label="YouTube" className={iconClass}>
            <Youtube className="w-5 h-5 cursor-pointer" />
          </a>
          <a href="#" aria-label="Facebook" className={iconClass}>
            <Facebook className="w-5 h-5 cursor-pointer" />
          </a>
          <a href="#" aria-label="Instagram" className={iconClass}>
            <Instagram className="w-5 h-5 cursor-pointer" />
          </a>
        </>
      )}
    </>
  );

  const columnHeading = "font-bold text-white uppercase tracking-widest text-[11px] mb-3";

  return (
    <footer className="bg-primary-earth text-white pt-12 pb-16 md:pb-20 lg:pt-16 lg:pb-10">
      <div className="max-w-3xl lg:max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Mobile: single centered column (unchanged).
            Desktop: three real columns, brand column widest. */}
        {/* Everything stays centre-aligned at every breakpoint — the desktop
            grid only exists to place the blocks side by side so the footer
            stays short, not to left-align their text.
            gap-x only: it's a single row at lg, and pairing a shorthand gap
            with gap-y-0 would leave row-gap dependent on stylesheet order. */}
        <div className="flex flex-col items-center gap-6 text-center lg:grid lg:grid-cols-[1.5fr_1fr] lg:gap-x-16 lg:items-start">
          {/* Brand + about */}
          <div>
            <h1 className="text-2xl font-medium tracking-widest text-white mb-4 uppercase flex flex-row items-center justify-center gap-2" dir="ltr">
              <span className="text-accent-lavender text-lg">🌸</span>
              BELLAURA <span className="text-accent-lavender font-light">OILS</span>
              <span className="text-accent-lavender text-lg">🌸</span>
            </h1>
            <p className="text-white/70 text-sm leading-relaxed max-w-lg mx-auto">
              {footerAbout}
            </p>
          </div>

          {/*
            Contact + About/FAQ as one tidy group under a single "Contact us"
            heading. The separate "Quick Links" column was removed per
            request; leaving those two links as a bare, heading-less column
            next to a headed one looked unbalanced, so they now sit with the
            contact details they belong with — email and WhatsApp first, then
            the two page links beneath a hairline divider.
          */}
          <div className="w-full lg:w-auto flex flex-col items-center gap-3 text-sm text-white/80">
            <h3 className={columnHeading}>
              {t('footer.links.contact')}
            </h3>

            <div className="flex flex-col sm:flex-row lg:flex-col items-center justify-center gap-3 text-xs">
              {/* Email */}
              <div className="flex items-center gap-2 bg-white/5 px-3.5 py-1.5 rounded-full border border-white/10" dir="ltr">
                <Mail className="w-3.5 h-3.5 text-accent-gold shrink-0" />
                <a href={`mailto:${email}`} className="hover:text-accent-gold transition-colors font-medium break-all">
                  {email}
                </a>
              </div>

              {/* WhatsApp Direct */}
              <div className="flex items-center gap-2 bg-emerald-500/10 px-3.5 py-1.5 rounded-full border border-emerald-500/20 text-emerald-300" dir="ltr">
                <svg className="w-3.5 h-3.5 fill-current text-emerald-400 shrink-0" viewBox="0 0 24 24">
                  <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l.999 1.595-1.025 3.743 3.769-.971 1.503.901z"/>
                </svg>
                <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="hover:text-emerald-200 transition-colors font-medium">
                  WhatsApp
                </a>
              </div>

            </div>

            <div className="flex items-center justify-center gap-4 text-sm font-medium pt-2 mt-1 border-t border-white/10 w-full max-w-[220px]">
              <Link to={storeSettings?.footerAboutUrl || "/about"} className="hover:text-accent-gold transition-colors">
                {t('footer.links.about')}
              </Link>
              <span className="text-white/20" aria-hidden="true">·</span>
              <Link to={storeSettings?.footerFaqUrl || "/faq"} className="hover:text-accent-gold transition-colors">
                {t('footer.links.faq')}
              </Link>
            </div>
          </div>
        </div>

        {/*
          Socials + copyright.

          Mobile is deliberately identical to the original: a centered social
          row, then a full-width horizontal rule with the copyright beneath
          it (24px above the socials, 32px between socials and the rule).
          At lg the two sit on one centred line under a rule, which keeps the
          footer short without pushing the copyright text off to an edge —
          everything in this footer stays centre-aligned. The rule therefore
          lives on the copyright block below `lg`, and on the wrapper from
          `lg` up.
        */}
        <div className="mt-6 lg:mt-10 flex flex-col items-center gap-8 lg:flex-row lg:items-center lg:justify-center lg:gap-10 lg:border-t lg:border-white/10 lg:pt-6">
          <div className="flex gap-6 items-center justify-center">
            {socialLinks}
          </div>
          <div className="w-full lg:w-auto border-t border-white/10 pt-6 lg:border-t-0 lg:pt-0">
            <p className="text-[10px] uppercase tracking-widest text-white/40 text-center">
              © 2026 Bellaura Oils. {footerRights}
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
