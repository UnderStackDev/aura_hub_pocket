// background.js — Aura Hub Pocketin service worker.
// Omistaa palvelulistan (storage.local), auki olevat Pocket-ikkunat (storage.session),
// mobiilitilan DNR-säännöt sekä lukemattomien badgen. Käynnistin vain lukee tilaa ja
// pyytää muutokset viesteillä, jotta kaikki kirjoitukset kulkevat saman lukon läpi.

import { DEFAULT_SERVICES, DEFAULT_SIZE, serviceKey, unreadFromTitle } from './common.js';

const LILAC = '#B6A1E5';
const EDITABLE = ['name', 'url', 'mobile', 'width', 'height', 'pinned'];

// Ilman resourceTypes-ehtoa DNR ohittaa main_framen, joten kaikki tyypit luetellaan.
const ALL_TYPES = ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
  'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'];

// --- Lukko: read-modify-write ei saa limittyä ---------------------------------------------

let chain = Promise.resolve();
function locked(fn) {
  const run = chain.then(() => fn());
  chain = run.catch(() => {});
  return run;
}

// --- Tila -----------------------------------------------------------------------------------

const getServices = async () => (await chrome.storage.local.get('services')).services || [];
const setServices = services => chrome.storage.local.set({ services });
const getOpen = async () => (await chrome.storage.session.get('open')).open || {};
const setOpen = open => chrome.storage.session.set({ open });

function openIdForTab(open, tabId) {
  return Object.keys(open).find(id => open[id].tabId === tabId);
}

// --- Mobiilitila ----------------------------------------------------------------------------

function mobileUA() {
  const major = navigator.userAgent.match(/Chrome\/(\d+)/)?.[1] || '130';
  return `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Mobile Safari/537.36`;
}

// Sääntö koskee vain yhtä välilehteä, joten tavallinen selailu samassa palvelussa pysyy
// työpöytätilassa. Server-Timing-otsake kertoo mobile-ua.js:lle, että sivu on Pocket-ikkunassa.
async function setMobileRule(tabId, on) {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [tabId],
    addRules: on ? [{
      id: tabId,
      priority: 1,
      condition: { tabIds: [tabId], resourceTypes: ALL_TYPES },
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'user-agent', operation: 'set', value: mobileUA() },
          { header: 'sec-ch-ua-mobile', operation: 'set', value: '?1' },
          { header: 'sec-ch-ua-platform', operation: 'set', value: '"Android"' },
        ],
        responseHeaders: [
          { header: 'server-timing', operation: 'append', value: 'aura-pocket;desc="mobile"' },
        ],
      },
    }] : [],
  });
}

// --- Badge ----------------------------------------------------------------------------------

async function updateBadge(open) {
  const total = Object.values(open).reduce((sum, o) => sum + (o.unread || 0), 0);
  await chrome.action.setBadgeText({ text: total ? String(total) : '' });
}

async function flashBadge(text) {
  await chrome.action.setBadgeText({ text });
  setTimeout(async () => updateBadge(await getOpen()), 1500);
}

// --- Ikonit ---------------------------------------------------------------------------------

function maxSize(sizes = '') {
  if (/any/i.test(sizes)) return 512;
  return Math.max(0, ...sizes.split(/\s+/).map(s => parseInt(s, 10) || 0));
}

function stripUnread(title = '') {
  return title.replace(/^\(\d+\+?\)\s*|\s*\(\d+\+?\)$/g, '').trim();
}

async function collectFromTab(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      title: document.title,
      manifest: document.querySelector('link[rel="manifest"]')?.href || null,
      links: [...document.querySelectorAll('link[rel~="icon"], link[rel^="apple-touch-icon"]')]
        .map(l => ({ rel: l.rel, href: l.href, sizes: l.getAttribute('sizes') || '' })),
    }),
  });
  return result;
}

// Kun välilehteä ei ole (oletuspalvelut, linkin lisäys), luetaan <link>-tagit HTML:stä.
async function collectFromHtml(url) {
  const res = await fetch(url);
  const html = (await res.text()).slice(0, 400_000);
  const base = res.url;
  const attr = (tag, name) => {
    const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    return m ? (m[1] ?? m[2] ?? m[3]) : '';
  };
  const abs = href => { try { return new URL(href, base).href; } catch { return null; } };
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  const manifestTag = tags.find(t => /^manifest$/i.test(attr(t, 'rel')));
  return {
    title: html.match(/<title[^>]*>([^<]*)/i)?.[1]?.trim() || '',
    manifest: manifestTag ? abs(attr(manifestTag, 'href')) : null,
    links: tags
      .filter(t => /(^|\s)icon(\s|$)|^apple-touch-icon/i.test(attr(t, 'rel')))
      .map(t => ({ rel: attr(t, 'rel'), href: abs(attr(t, 'href')), sizes: attr(t, 'sizes') }))
      .filter(l => l.href),
  };
}

function bytesToDataUrl(type, buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
}

// Ikoni pienennetään 128 px PNG:ksi, jotta storage pysyy kevyenä.
async function iconToDataUrl(href) {
  const res = await fetch(href);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  try {
    const bmp = await createImageBitmap(blob);
    const side = Math.min(128, Math.max(bmp.width, bmp.height));
    const scale = side / Math.max(bmp.width, bmp.height);
    const canvas = new OffscreenCanvas(side, side);
    const w = bmp.width * scale, h = bmp.height * scale;
    canvas.getContext('2d').drawImage(bmp, (side - w) / 2, (side - h) / 2, w, h);
    const png = await canvas.convertToBlob({ type: 'image/png' });
    return bytesToDataUrl('image/png', await png.arrayBuffer());
  } catch (err) {
    // SVG ei dekoodaudu workerissa — kelpaa sellaisenaan, jos se on pieni.
    if (blob.type === 'image/svg+xml' && blob.size < 100_000) {
      return bytesToDataUrl(blob.type, await blob.arrayBuffer());
    }
    throw err;
  }
}

async function pickIcon(info, fallbackUrl) {
  const candidates = [];
  let manifestName = null;
  if (info?.manifest) {
    try {
      const manifest = await (await fetch(info.manifest)).json();
      manifestName = manifest.short_name || manifest.name || null;
      for (const icon of manifest.icons || []) {
        // Pelkät maskable-ikonit ovat reunoilta täytettyjä, joten niitä ei käytetä.
        if (icon.purpose && !/\bany\b/.test(icon.purpose)) continue;
        candidates.push({ href: new URL(icon.src, info.manifest).href, size: maxSize(icon.sizes), rank: 3 });
      }
    } catch {}
  }
  for (const link of info?.links || []) {
    const apple = /apple/i.test(link.rel);
    candidates.push({ href: link.href, size: maxSize(link.sizes) || (apple ? 180 : 32), rank: apple ? 2 : 1 });
  }
  if (fallbackUrl) candidates.push({ href: fallbackUrl, size: 16, rank: 0 });

  candidates.sort((a, b) => Math.min(b.size, 256) - Math.min(a.size, 256) || b.rank - a.rank);
  for (const c of candidates) {
    try {
      return { icon: await iconToDataUrl(c.href), manifestName };
    } catch {}
  }
  return { icon: null, manifestName };
}

const iconAttempts = new Set();

// Ei kutsuta lukon sisältä: haku on hidas, ja tallennus ottaa lukon itse.
async function fillIcon(id, info, fallbackUrl) {
  if (iconAttempts.has(id)) return;
  iconAttempts.add(id);
  try {
    const svc = (await getServices()).find(s => s.id === id);
    if (!svc || svc.icon) return;
    if (!info) info = await collectFromHtml(svc.url).catch(() => null);
    const { icon, manifestName } = await pickIcon(info, fallbackUrl);
    await locked(async () => {
      const services = await getServices();
      const target = services.find(s => s.id === id);
      if (!target) return;
      if (icon) target.icon = icon;
      if (target.autoName) {
        const name = manifestName || stripUnread(info?.title);
        if (name) target.name = name;
        target.autoName = false;
      }
      await setServices(services);
    });
  } finally {
    // Epäonnistunut haku saa yrittää uudelleen, kun palvelu seuraavan kerran avataan.
    const svc = (await getServices()).find(s => s.id === id);
    if (!svc?.icon) setTimeout(() => iconAttempts.delete(id), 60_000);
  }
}

// --- Palvelut -------------------------------------------------------------------------------

function normalizeUrl(raw) {
  let url = String(raw || '').trim();
  if (!/^[a-z]+:\/\//i.test(url)) url = `https://${url}`;
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) addresses can be added.');
  return u.href;
}

function addService({ url, name, mobile = false }) {
  return locked(async () => {
    const services = await getServices();
    const existing = services.find(s => serviceKey(s.url) === serviceKey(url));
    if (existing) return { service: existing, existed: true };
    const service = {
      id: crypto.randomUUID(),
      name: name || new URL(url).hostname.replace(/^www\./, ''),
      autoName: !name,
      url,
      mobile,
      ...DEFAULT_SIZE,
      icon: null,
      pinned: false,
      lastUsed: Date.now(),
    };
    services.push(service);
    await setServices(services);
    return { service, existed: false };
  });
}

async function addFromTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const info = await collectFromTab(tabId).catch(() => null);
  const result = await addService({ url: normalizeUrl(tab.url), name: stripUnread(tab.title) || undefined });
  if (!result.existed) fillIcon(result.service.id, info, tab.favIconUrl);
  return result;
}

function openService(id) {
  return locked(async () => {
    const services = await getServices();
    const svc = services.find(s => s.id === id);
    if (!svc) throw new Error('Service not found.');
    svc.lastUsed = Date.now();
    await setServices(services);

    const open = await getOpen();
    if (open[id]) {
      try {
        await chrome.windows.update(open[id].windowId, { focused: true, state: 'normal' });
        return { reused: true };
      } catch {
        delete open[id];
      }
    }

    // Ikkuna avataan tunnistesivulla: Hyprland tunnistaa sen otsikosta, ja mobiilisääntö
    // ehtii voimaan ennen palvelun ensimmäistä pyyntöä.
    const win = await chrome.windows.create({
      type: 'popup',
      url: chrome.runtime.getURL('pocket-start.html'),
      width: svc.width || DEFAULT_SIZE.width,
      height: svc.height || DEFAULT_SIZE.height,
      focused: true,
    });
    const tabId = win.tabs[0].id;
    if (svc.mobile) await setMobileRule(tabId, true);
    open[id] = { windowId: win.id, tabId, unread: 0 };
    await setOpen(open);
    await chrome.tabs.update(tabId, { url: svc.url });
    return { reused: false };
  });
}

function updateService(id, patch) {
  return locked(async () => {
    const services = await getServices();
    const svc = services.find(s => s.id === id);
    if (!svc) throw new Error('Service not found.');
    const before = { ...svc };
    for (const key of EDITABLE) if (key in patch) svc[key] = patch[key];
    if ('url' in patch) svc.url = normalizeUrl(patch.url);
    if ('name' in patch) svc.autoName = false;
    for (const key of ['width', 'height']) {
      svc[key] = Math.min(2000, Math.max(280, Number(svc[key]) || DEFAULT_SIZE[key]));
    }
    await setServices(services);

    const o = (await getOpen())[id];
    if (!o) return { service: svc };
    if (svc.mobile !== before.mobile) {
      await setMobileRule(o.tabId, svc.mobile);
      await chrome.tabs.reload(o.tabId, { bypassCache: true });
    }
    if (svc.width !== before.width || svc.height !== before.height) {
      await chrome.windows.update(o.windowId, { width: svc.width, height: svc.height }).catch(() => {});
    }
    return { service: svc };
  });
}

function removeService(id) {
  return locked(async () => {
    await setServices((await getServices()).filter(s => s.id !== id));
    const open = await getOpen();
    if (open[id]) {
      await setMobileRule(open[id].tabId, false);
      delete open[id];
      await setOpen(open);
      await updateBadge(open);
    }
    return {};
  });
}

// --- Käynnistinikkuna -----------------------------------------------------------------------

// Käynnistin on oma popup-ikkunansa eikä selaimen kupla: Hyprland pyöristää ikkunan kulmat
// ja piirtää teeman reunuksen, kuplan kulmiin ei pääse käsiksi. Toinen painallus sulkee sen.
let launcherClosedAt = 0;

async function toggleLauncher(sourceTab) {
  // Kuvakkeen klikkaus vie fokuksen käynnistimeltä, ja se sulkeutuu jo ennen tätä
  // kutsua. Juuri suljettua ei avata uudelleen, jotta kuvake toimii kuten kuplan kanssa.
  if (Date.now() - launcherClosedAt < 500) return;
  const { launcherWindowId } = await chrome.storage.session.get('launcherWindowId');
  if (launcherWindowId) {
    try {
      await chrome.windows.remove(launcherWindowId);
      return;
    } catch {}
  }
  const count = (await getServices()).length;
  const params = sourceTab?.id >= 0 && /^https?:/.test(sourceTab.url || '') ? `?tab=${sourceTab.id}` : '';
  // Hyprland ei anna ikkunan muuttaa itse kokoaan, joten korkeus lasketaan valmiiksi:
  // otsikko + reunat 80, ruuturivi 103, "Current tab" -rivi 62. Vähintään muokkauspaneelin
  // (395) verran, jotta paneeli mahtuu kokonaan.
  const height = 80 + Math.max(1, Math.ceil(count / 3)) * 103 + (params ? 62 : 0);
  const win = await chrome.windows.create({
    type: 'popup',
    url: chrome.runtime.getURL(`launcher.html${params}`),
    width: 360,
    height: Math.min(900, Math.max(400, height)),
    focused: true,
  });
  await chrome.storage.session.set({ launcherWindowId: win.id });
}

chrome.action.onClicked.addListener(tab => toggleLauncher(tab));

// --- Tapahtumat -----------------------------------------------------------------------------

chrome.action.setBadgeBackgroundColor({ color: LILAC });
chrome.action.setBadgeTextColor({ color: '#14121f' });

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  chrome.contextMenus.removeAll(() => {
    const web = ['http://*/*', 'https://*/*'];
    chrome.contextMenus.create({ id: 'add-page', title: 'Add page to Aura Hub Pocket', contexts: ['page'], documentUrlPatterns: web });
    chrome.contextMenus.create({ id: 'add-link', title: 'Add link to Aura Hub Pocket', contexts: ['link'], targetUrlPatterns: web });
  });

  if (reason === 'install' && !(await getServices()).length) {
    await setServices(DEFAULT_SERVICES.map(s => ({
      ...DEFAULT_SIZE, icon: null, pinned: false, lastUsed: 0, autoName: false, ...s,
    })));
    for (const s of DEFAULT_SERVICES) await fillIcon(s.id).catch(() => {});
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'add-page' && tab?.id >= 0) {
      await addFromTab(tab.id);
    } else if (info.menuItemId === 'add-link') {
      const { service, existed } = await addService({ url: normalizeUrl(info.linkUrl) });
      if (!existed) fillIcon(service.id);
    }
    await flashBadge('+');
  } catch {
    await flashBadge('!');
  }
});

chrome.windows.onRemoved.addListener(windowId => locked(async () => {
  const { launcherWindowId } = await chrome.storage.session.get('launcherWindowId');
  if (launcherWindowId === windowId) {
    launcherClosedAt = Date.now();
    await chrome.storage.session.remove('launcherWindowId');
    return;
  }
  const open = await getOpen();
  const id = Object.keys(open).find(k => open[k].windowId === windowId);
  if (!id) return;
  await setMobileRule(open[id].tabId, false);
  delete open[id];
  await setOpen(open);
  await updateBadge(open);
}));

// Käyttäjän muuttama koko muistetaan palvelukohtaisesti. Waylandissa selain tietää koon
// mutta ei paikkaa, joten paikka tulee Hyprlandin säännöstä.
chrome.windows.onBoundsChanged.addListener(win => locked(async () => {
  const open = await getOpen();
  const id = Object.keys(open).find(k => open[k].windowId === win.id);
  if (!id || !win.width || !win.height) return;
  const services = await getServices();
  const svc = services.find(s => s.id === id);
  if (!svc || (svc.width === win.width && svc.height === win.height)) return;
  svc.width = win.width;
  svc.height = win.height;
  await setServices(services);
}));

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (!('title' in change) && change.status !== 'complete') return;
  locked(async () => {
    const open = await getOpen();
    const id = openIdForTab(open, tabId);
    if (!id) return;
    if ('title' in change) {
      const unread = unreadFromTitle(change.title);
      if (unread !== open[id].unread) {
        open[id].unread = unread;
        await setOpen(open);
        await updateBadge(open);
      }
    }
    if (change.status === 'complete') {
      collectFromTab(tabId)
        .then(info => fillIcon(id, info, tab.favIconUrl), () => fillIcon(id, null, tab.favIconUrl))
        .catch(() => {});
    }
  });
});

const handlers = {
  open: m => openService(m.id),
  addTab: m => addFromTab(m.tabId),
  addUrl: async m => {
    const result = await addService({ url: normalizeUrl(m.url), name: m.name || undefined, mobile: !!m.mobile });
    if (!result.existed) fillIcon(result.service.id);
    return result;
  },
  update: m => updateService(m.id, m.patch || {}),
  remove: m => removeService(m.id),
};

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  Promise.resolve()
    .then(() => handler(msg))
    .then(reply, err => reply({ error: err?.message || String(err) }));
  return true;
});
