// launcher.js — käynnistimen näkymä. Lukee tilan storagesta ja pyytää kaikki muutokset
// background.js:ltä viesteillä.

import { DEFAULT_SIZE, serviceKey, sortServices } from './common.js';

const $ = id => document.getElementById(id);
const PIN_SVG = '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 6 3 3H7l3-3-1-6zM12 13v7"/></svg>';
const PEN_SVG = '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>';

let services = [];
let open = {};
let editing = false;
let currentTab = null;
let sheetFor = null; // palvelun id, tai 'new'

async function send(msg) {
  const res = await chrome.runtime.sendMessage(msg);
  if (res?.error) throw new Error(res.error);
  return res;
}

function showError(err) {
  const el = $('error');
  el.textContent = err ? String(err.message || err) : '';
  el.hidden = !err;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// --- Renderöinti ----------------------------------------------------------------------------

function tile(svc, index) {
  const button = el('button', 'tile');
  button.style.animationDelay = `${Math.min(index, 12) * 18}ms`;
  button.title = editing ? `Edit ${svc.name}` : svc.name;

  const icon = el('div', 'tile-icon');
  if (svc.icon) {
    const img = el('img');
    img.src = svc.icon;
    img.alt = '';
    icon.append(img);
  } else {
    icon.classList.add('mono');
    icon.textContent = svc.name.slice(0, 1).toUpperCase();
  }
  button.append(icon, el('span', 'tile-name', svc.name));

  const state = open[svc.id];
  if (editing) {
    const mark = el('span', 'edit-mark');
    mark.innerHTML = PEN_SVG;
    button.append(mark);
  } else if (state?.unread) {
    button.append(el('span', 'badge', state.unread > 99 ? '99+' : String(state.unread)));
  }
  if (svc.pinned) {
    const pin = el('span', 'pin-mark');
    pin.innerHTML = PIN_SVG;
    button.append(pin);
  }
  if (state) button.append(el('span', 'open-dot'));

  button.addEventListener('click', () => (editing ? openSheet(svc.id) : launch(svc.id)));
  return button;
}

function render() {
  document.body.classList.toggle('editing', editing);
  $('edit-toggle').setAttribute('aria-pressed', String(editing));

  const grid = $('grid');
  grid.replaceChildren(...sortServices(services).map(tile));
  $('empty').hidden = services.length > 0;

  const known = currentTab && services.some(s => serviceKey(s.url) === serviceKey(currentTab.url));
  $('offer').hidden = !currentTab || known;
  if (currentTab && !known) {
    $('offer-title').textContent = currentTab.title || currentTab.url;
    const img = $('offer-icon');
    img.hidden = !currentTab.favIconUrl;
    if (currentTab.favIconUrl) img.src = currentTab.favIconUrl;
  }
}

async function load() {
  const [{ services: list = [] }, { open: o = {} }] = await Promise.all([
    chrome.storage.local.get('services'),
    chrome.storage.session.get('open'),
  ]);
  services = list;
  open = o;
  render();
}

// --- Toiminnot ------------------------------------------------------------------------------

async function launch(id) {
  try {
    await send({ type: 'open', id });
    window.close();
  } catch (err) {
    showError(err);
  }
}

function openSheet(id) {
  sheetFor = id;
  const isNew = id === 'new';
  const svc = isNew ? null : services.find(s => s.id === id);
  if (!isNew && !svc) return;

  $('sheet-title').textContent = isNew ? 'Add service' : 'Edit service';
  $('edit-only').hidden = isNew;
  $('f-delete').hidden = isNew;
  $('f-name').value = svc?.name || '';
  $('f-url').value = svc?.url || '';
  $('f-mobile').checked = !!svc?.mobile;
  $('f-pinned').checked = !!svc?.pinned;
  $('f-width').value = svc?.width || DEFAULT_SIZE.width;
  $('f-height').value = svc?.height || DEFAULT_SIZE.height;

  $('sheet-backdrop').hidden = false;
  (isNew ? $('f-url') : $('f-name')).focus();
}

function closeSheet() {
  sheetFor = null;
  $('sheet-backdrop').hidden = true;
}

async function saveSheet(event) {
  event.preventDefault();
  try {
    if (sheetFor === 'new') {
      await send({ type: 'addUrl', url: $('f-url').value, name: $('f-name').value.trim(), mobile: $('f-mobile').checked });
    } else {
      await send({
        type: 'update',
        id: sheetFor,
        patch: {
          name: $('f-name').value.trim() || services.find(s => s.id === sheetFor)?.name,
          url: $('f-url').value,
          mobile: $('f-mobile').checked,
          pinned: $('f-pinned').checked,
          width: Number($('f-width').value),
          height: Number($('f-height').value),
        },
      });
    }
    showError(null);
    closeSheet();
  } catch (err) {
    showError(err);
    closeSheet();
  }
}

async function removeFromSheet() {
  try {
    await send({ type: 'remove', id: sheetFor });
    closeSheet();
  } catch (err) {
    showError(err);
  }
}

async function addCurrentTab() {
  try {
    await send({ type: 'addTab', tabId: currentTab.id });
  } catch (err) {
    showError(err);
  }
}

// --- Käynnistys -----------------------------------------------------------------------------

$('edit-toggle').addEventListener('click', () => { editing = !editing; render(); });
$('add-btn').addEventListener('click', () => openSheet('new'));
$('offer-add').addEventListener('click', addCurrentTab);
$('sheet').addEventListener('submit', saveSheet);
$('f-cancel').addEventListener('click', closeSheet);
$('f-delete').addEventListener('click', removeFromSheet);
$('sheet-backdrop').addEventListener('click', e => { if (e.target === e.currentTarget) closeSheet(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  if (sheetFor) closeSheet();
  else window.close();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.services) services = changes.services.newValue || [];
  else if (area === 'session' && changes.open) open = changes.open.newValue || {};
  else return;
  render();
});

// Käynnistin on oma ikkunansa ja sulkeutuu, kun fokus lähtee eli kun klikataan muualle.
// Hyprlandin säännön no_follow_mouse ansiosta pelkkä hiiren vienti toisen ikkunan päälle
// ei vie fokusta (~/.config/hypr/aura-hub-pocket.lua). Muokkauspaneeli ei sulkeudu kesken.
window.addEventListener('blur', () => {
  if (!sheetFor) window.close();
});

// Ilman fokusta blur ei koskaan laukeaisi, joten fokus pyydetään varmuuden vuoksi.
if (!document.hasFocus()) {
  chrome.windows.getCurrent().then(win => chrome.windows.update(win.id, { focused: true }));
}

const tabId = Number(new URLSearchParams(location.search).get('tab'));
if (tabId) currentTab = await chrome.tabs.get(tabId).catch(() => null);
await load();
