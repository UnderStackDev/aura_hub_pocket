# Aura Hub Pocket — suunnitelma (luonnos 2026-10-19)

Työnimi: **Aura Hub Pocket** (`aura_hub_pocket`). Yksityinen, ei julkaisuun ainakaan aluksi.

Paranneltu versio [Aura Hubista](https://github.com/UnderStackDev/aura_hub) (Electron), jota ei ole
asennettu tälle koneelle. Idea on sama — omat kelluvat ikkunat päivittäisille webpalveluille —
mutta ilman omaa selainmoottoria: kaikki pyörii Brave Originin sisällä.

## 1. Tavoitteet

1. **Mobiilisivut omissa ikkunoissaan** — Messenger, TikTok, Google Keep jne. aukeavat kapeaan,
   puhelimen kokoiseen ikkunaan ilman välilehtiä ja osoiteriviä.
2. **Kelluu muiden päällä** — ikkuna jää näkyviin kun tekee samalla muuta (float + pin Hyprlandissa).
3. **Nätti käynnistin** — aukaistessa lista palveluista, viimeksi käytetyt ensin, Aura-tyylillä.
4. **Helppo lisätä suoraan selaimesta** — "Add to Aura Hub Pocket" nykyisestä välilehdestä.
5. **Selaimen omat edut ilmaiseksi** — Brave Shields -mainosesto, kirjautumiset, salasanat ja muut
   laajennukset toimivat sellaisenaan. Ei Aura Hubin HTTPS-uudelleenkirjoitusta, UA-huijausta
   Googlea vastaan eikä laajennusten polyfillausta.

Ei-tavoitteet: oma selainmoottori, Windows-tuki (aluksi), palveluiden sisällön muokkaaminen.

## 2. Arkkitehtuuripäätös: MV3-laajennus + native messaging -apuohjelma

| Vaihtoehto | Miksi ei / miksi kyllä |
|---|---|
| Electron (nykyinen Aura Hub) | Oma Chromium-kopio, oma mainosesto ja kirjautumiset erikseen. Juuri tämä halutaan pois. |
| Tauri | WebKitGTK eikä Chromium → ei Braven mainosestoa eikä kirjautumisia. Lisäksi WebKit-äpeillä EGL- ja rtkit-ongelmia tällä koneella. |
| Pelkät Brave-PWA:t | Ei käynnistintä, ei mobiilitilaa, jokainen asennetaan käsin. |
| **Laajennus + native host** ✅ | Ikkunat ovat oikeita Brave-ikkunoita samassa profiilissa. Laajennus hoitaa listan ja mobiilitilan, pieni apuohjelma hoitaa Hyprland-ikkunanhallinnan, jota selain ei Waylandissa itse pysty tekemään. |

```
 Brave Origin
 ┌─────────────────────────────────────────────┐
 │  Laajennus (MV3)                            │
 │   • service worker: palvelulista, ikkunat,  │
 │     mobiili-UA-säännöt, badget              │
 │   • launcher.html: Aura-tyylinen lista      │
 │   • kontekstivalikko: "Add to …"            │
 └──────────────┬──────────────────────────────┘
                │ native messaging (stdin/stdout JSON)
 ┌──────────────▼──────────────────────────────┐
 │  aura-hub-pocket-host (pieni skripti)       │
 │   • hyprctl: float, pin, koko, paikka       │
 │   • muistaa ikkunan paikan per palvelu      │
 └─────────────────────────────────────────────┘
```

## 3. Osat

### 3.1 Käynnistin
- Laajennuksen oma sivu `launcher.html`, avautuu pieneen popup-ikkunaan (ja laajennuksen
  painikkeesta selaimen työkalupalkissa).
- Ruudukko tai lista: ikoni, nimi, lukemattomien merkki. Järjestys: viimeksi käytetty ensin,
  kiinnitetyt ylimpänä.
- Klikkaus avaa palvelun — tai tuo jo auki olevan ikkunan esiin (ei tuplaikkunoita).
- Muokkaus: nimeä, vaihda ikoni, mobiili/työpöytä-UA, ikkunan koko, poista, järjestä vetämällä.
- Tyyli: Aura-tyyli (äppi, ei plugin), UI-teksti englanniksi.

### 3.2 Palveluikkunat
- `chrome.windows.create({ type: 'popup', url, width, height })` → ei välilehtiä eikä osoiteriviä.
- Oletuskoko puhelinmainen, esim. 420×860; palvelukohtaisesti muutettavissa.
- Laajennus tietää jokaisen ikkunan `windowId`:n ja `tabId`:n → mobiilisäännöt ja badget
  koskevat vain Pocket-ikkunoita, ei tavallista selailua.

### 3.3 Mobiilitila (palvelukohtainen kytkin)
- **User-Agent + Client Hints -otsakkeet:** `declarativeNetRequest`-session-säännöt, rajattu
  `tabIds`-ehdolla vain Pocket-ikkunoiden välilehtiin. Asettaa Android-Chrome-UA:n sekä
  `Sec-CH-UA-Mobile: ?1` ja `Sec-CH-UA-Platform: "Android"`.
- **JS-puoli:** skripti sivun MAIN-maailmassa mahdollisimman aikaisin (`document_start`), joka
  korjaa `navigator.userAgent`, `userAgentData`, `platform` ja `maxTouchPoints`.
- Kapea ikkuna saa responsiiviset sivut (esim. Keep) mobiiliasetteluun jo yksinään →
  mobiili-UA kannattaa kytkeä päälle vain siellä missä siitä on hyötyä.
- **Ei** käytetä `chrome.debugger`-emulointia (antaisi täyden kosketusemuloinnin, mutta Brave
  näyttää silloin keltaisen "debugging"-palkin). Varasuunnitelma, jos jokin palvelu vaatii.

### 3.4 "Add to Aura Hub Pocket"
- Laajennuksen painike + hiiren oikean napin valikko sivulla ja linkissä.
- Hakee automaattisesti nimen (`<title>`/manifest `short_name`), ikonin (web app manifestin isoin
  ikoni → `apple-touch-icon` → favicon) ja URL:n. Ikoni tallennetaan data-URL:nä.
- Kysyy lyhyesti: nimi, mobiili-UA kyllä/ei. Valmis.

### 3.5 Kellunta — TOTEUTETTU ilman apuohjelmaa (2026-10-19)

Testissä selvisi, että selain antaa laajennuksen avaamille popup-ikkunoille oman
Wayland-luokan `<selain>-<laajennuksen id>-<profiili>` (esim. `chrome-pmkkfnndhjfbmanlfehaplkobkoebifi-Default`).
Siksi kellunta hoituu staattisella Hyprland-säännöllä, eikä native hostia tarvita:

- `~/.config/hypr/aura-hub-pocket.lua` (ladataan `hyprland.lua`:sta): float + pin +
  `no_shortcuts_inhibit` + paikka oikeaan reunaan.
- ID tulee laajennuskansion polusta (Load unpacked) → **kansiota ei saa siirtää**, tai sääntö
  pitää päivittää. Manifestin `key`-avainta ei käytetä, koska se vaihtaisi ID:n ja hukkaisi
  jo tallennetut palvelut.
- `initial_title` ei kelpaa tunnisteeksi: ikkuna voi näkyä Hyprlandille ennen kuin otsikko
  on asetettu (`_crx_<id>`).
- Koko: selain välittää pyydetyn koon, ja käyttäjän muuttama koko tallentuu palvelulle
  (`windows.onBoundsChanged`). Waylandissa selain ei tiedä ikkunan paikkaa.
- Ikkuna aukeaa ensin tummalle `pocket-start.html`-sivulle → ei valkoista välähdystä.

Alla alkuperäinen native host -suunnitelma, joka tarvitaan enää vain, jos halutaan
**paikan** muistaminen palvelukohtaisesti:

### 3.5b Native host (valinnainen, paikan muistaminen)
- Pieni apuohjelma, rekisteröity Brave Originille:
  `~/.config/BraveSoftware/Brave-Origin/NativeMessagingHosts/`.
- Kun laajennus avaa ikkunan, se lähettää hostille `{ service, size, position }`.
  Host etsii uuden ikkunan `hyprctl clients -j`:stä ja tekee float + pin + koko + paikka.
- Lua-forkin syntaksi: `hyprctl dispatch 'hl.dsp.window.float({ ... })'` jne., ei klassista muotoa.
- Kun käyttäjä siirtää/muuttaa ikkunaa, host tallentaa paikan per palvelu → aukeaa samaan kohtaan.

### 3.6 Lukemattomien merkit
- `chrome.tabs.onUpdated` seuraa otsikkoa: "(3) Messenger" → badge 3 käynnistimessä ja
  laajennuksen kuvakkeessa. Myöhemmin mahdollisesti Aura Bariin.

### 3.7 Pikanäppäin
- Hyprland-sidonta, joka avaa käynnistimen mistä tahansa (vapaa yhdistelmä valitaan myöhemmin,
  ei ylikirjoiteta stock-sidontoja).

## 4. Riskit ja avoimet kysymykset

1. **Messenger** — Meta ohjaa mobiiliweb-viestittelyä sovellukseen; mobiili-UA voi tuoda
   "lataa sovellus" -seinän. Testataan sekä mobiili- että työpöytä-UA kapeassa ikkunassa.
2. **TikTok** tyrkyttää sovellusta mobiiliwebissä, katselu toimii.
3. **Ikkunan tunnistus Hyprlandissa** — Brave-popupit näyttävät tavallisilta Brave-ikkunoilta.
   *Avoin päätös, testataan prototyypissä:*
   - (a) `chrome.windows.create` popup + host tunnistaa uuden ikkunan `hyprctl clients -j`-erosta
     (nopea, laajennus hallitsee ikkunaa suoraan), tai
   - (b) host käynnistää `brave-origin --app=URL` → Hyprland-luokka on ennustettava
     (`brave-<domain>__…-Default`) ja staattiset ikkunasäännöt toimivat, myös olemassa oleva
     `no_shortcuts_inhibit`-sääntö. Laajennus näkee ikkunan silti.
   Kallistun (b):hen, jos (a):n tunnistus osoittautuu epäluotettavaksi.
4. **Pikanäppäinten nielaisu** — web-app-ikkunat voivat napata Waylandin shortcuts-inhibit-
   protokollan. Varmistetaan, että globaalit näppäimet toimivat Pocket-ikkunoissa.
5. **MAIN-maailman UA-skriptin ajoitus** — jos se ehtii ajaa vasta sivun skriptien jälkeen,
   osa sivuista näkee työpöytä-UA:n JS:ssä. Testataan per palvelu.

## 5. Vaiheet

1. **MVP (laajennus)** — palvelulista, käynnistin, popup-ikkunat, ei-tuplaikkunoita,
   "Add current tab", mobiili-UA-kytkin. Ladataan Brave Originiin "Load unpacked" -tavalla.
2. **Kellunta** ✅ — Hyprland-sääntö luokan perusteella (päätös 4.3 ratkaistu: kumpikaan
   alkuperäisistä vaihtoehdoista, vaan laajennuksen oma ikkunaluokka). Koon muistaminen ✅.
   Paikan muistaminen jätetty pois (käyttäjän päätös: oikea reuna riittää) → ei native hostia.
   Käynnistin avautuu omaan ikkunaansa selaimen kuplan sijaan, jotta Hyprland pyöristää kulmat.
3. **Viimeistely** — Aura-tyyli loppuun, lukemattomien merkit, pikanäppäin.

Oletuspalvelut (päätetty 2026-10-19): Messenger, TikTok, Google Keep, WhatsApp, Radioplayer.
Claude ja Gemini jätetään pois. YouTube jätetään pois, koska sille on jo oma ratkaisu
(YouTube tile -laajennus) — ellei sitä myöhemmin yhdistetä tähän.
4. **Myöhemmin (ehkä)** — badget Aura Bariin, palvelulistan synkronointi `chrome.storage.sync`.

## 6. Hakemistorakenne (alustava)

```
aura_hub_pocket/
  PLAN.md
  extension/
    manifest.json
    background.js        # service worker
    launcher.html / .css / .js
    mobile-ua.js         # MAIN-maailman UA-korjaus
    icons/
  host/
    aura-hub-pocket-host # native messaging -apuohjelma
    install.sh           # rekisteröi hostin Brave Originille
```
