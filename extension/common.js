// common.js — taustaskriptin ja käynnistimen yhteiset apufunktiot.

export const DEFAULT_SIZE = { width: 420, height: 860 };

export const DEFAULT_SERVICES = [
  { id: 'messenger',   name: 'Messenger',   url: 'https://www.facebook.com/messages/', mobile: false },
  { id: 'tiktok',      name: 'TikTok',      url: 'https://www.tiktok.com/',            mobile: true  },
  { id: 'keep',        name: 'Google Keep', url: 'https://keep.google.com/',           mobile: false },
  { id: 'whatsapp',    name: 'WhatsApp',    url: 'https://web.whatsapp.com/',          mobile: false, width: 480 },
  { id: 'radioplayer', name: 'Radioplayer', url: 'https://play.radioplayer.org/fi',    mobile: false, height: 760 },
];

// Sama palvelu = sama origin + polku (ilman loppukauttaviivaa, queryä ja hashia).
export function serviceKey(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/+$/, '');
  } catch {
    return url;
  }
}

// Kiinnitetyt ensin, sitten viimeksi käytetty ensin.
export function sortServices(services) {
  return [...services].sort((a, b) =>
    (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.lastUsed || 0) - (a.lastUsed || 0));
}

// "(3) Messenger" / "Messenger (3)" → 3
export function unreadFromTitle(title = '') {
  const m = title.match(/^\((\d+)\+?\)|\((\d+)\+?\)$/);
  return m ? Number(m[1] || m[2]) : 0;
}
