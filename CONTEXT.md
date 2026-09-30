# The Button: project context

A complete handoff document for anyone (person or AI) picking up this project. It covers what the product is, how it's built, how every part fits together, the decisions made along the way, and the gotchas learned while building it.

> Last updated: 2026-09-30. Source of truth is the code; this file describes it as of this date.

---

## 1. What it is

**The Button** is a one-page website with a single button that anyone can buy. Whoever pays the most **owns the button, and the whole page**, until someone outbids them. The owner turns the page into their own advert or showcase: colors, background, typography, floating brand imagery, a soundtrack, a link that every button press sends visitors to, a featured video, and extra links. Everyone watching sees changes live.

The site is styled as a **retro-futurist TV broadcast**: the page is a live channel, and the owner "owns the airtime". It has a channel logo, an ON AIR tag, a lower-third name caption, a news crawl, CRT glass, and a "BREAKING" banner when the button changes hands.

Audience: brands, creators, and anyone who wants attention. Core loop: **see who's on air → press their button → outbid them → design your page → you're on air.**

---

## 2. Running it

| What | How |
|---|---|
| Requirements | Node 18+ (uses built-in `fetch`, `--watch`). **No npm dependencies.** |
| Start (production) | `npm start` → `node server.js` |
| Start (development) | `npm run dev` → `node --watch server.js` (restarts when `server.js` changes; front-end files are read on every request, so a browser refresh is enough for those) |
| URL | http://localhost:4321 (default port) |
| Preview config | [.claude/launch.json](.claude/launch.json) → configuration `the-button` runs `npm run dev` on port 4321 |
| Mode | **Demo** by default (bids are free). Setting `STRIPE_SECRET_KEY` switches to real payments via Stripe Checkout. |

### Environment variables ([server.js](server.js), top of file)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4321` | HTTP port |
| `BASE_URL` | `http://localhost:PORT` | Public URL, used for the Stripe return and cancel URLs |
| `STRIPE_SECRET_KEY` | none | Enables real payments (`MODE = 'stripe'`) |
| `ADMIN_KEY` | none | Enables the moderation endpoints |
| `CURRENCY` | `usd` | Stripe currency |
| `START_PRICE_CENTS` | `100` | Opening bid ($1) |
| `MIN_INCREMENT_CENTS` | `100` | Minimum raise ($1) |
| `MIN_INCREMENT_PCT` | `5` | Minimum raise as % of the current price (the larger of the two applies) |
| `DATA_DIR` | `./data` | Where `state.json` and `uploads/` live. **Used to run isolated test servers** (see §11). |

Hard cap: `MAX_BID = $100,000,000`.

---

## 3. Stack and principles

- **Zero dependencies.** Plain Node `http`, `fs` and `crypto`. No framework, no bundler, no database.
- **Real-time over Server-Sent Events** (`/api/stream`), not WebSockets.
- **Persistence:** one JSON file (`data/state.json`). Writes are debounced by 500 ms, written to `state.json.tmp` then atomically renamed, and flushed on `SIGINT`/`SIGTERM`.
- **Front end:** hand-written HTML, CSS and vanilla JS (`public/`). No build step.
- **Everything the owner submits is validated server-side** (`cleanConfig` and friends): enums, clamped numbers, hex-only colors, `http(s)`-only URLs, length limits. The client also validates, but only for user experience.
- **Security headers:** a strict CSP on pages; uploads are served with `nosniff` and `sandbox`.
- **One screen, no page scroll.** Everything beyond the stage opens as a popup, which becomes a bottom sheet on phones.

---

## 4. File map

```
.
├── server.js            (~780 lines)   HTTP server, API, SSE, validation, persistence, uploads, Stripe
├── public/
│   ├── index.html       (~620 lines)   Markup: stage, channel chrome, dock, all popups, wizard, SVG icons + filters
│   ├── style.css        (~1300 lines)  Broadcast design system, stage, button, beat FX, popups, wizard, responsive
│   ├── app.js           (~1960 lines)  All client logic (see section map below)
│   └── favicon.svg
├── data/                (gitignored)   state.json + uploads/  ← live auction data
├── .claude/launch.json                 preview server config
├── package.json                        scripts: start, dev
├── README.md                           user-facing feature/setup docs
└── CONTEXT.md                          this file
```

### `public/app.js`, section by section (in file order)

| Section | Key functions | Purpose |
|---|---|---|
| Formatting | `money`, `dur`, `clock`, `pct`, `safeUrl`, `h`, `icon`, `setText` | Helpers. `h(tag, props, ...kids)` is the DOM builder; `icon(name)` builds an `<svg><use href="#i-name">` |
| Popups | `openPopup` | One `<dialog>` open at a time; `[data-close]`; backdrop click closes (except the wizard) |
| The owner's page | `bgCss`, `textureCss`, `applyBackground`, `setDuotone`, `applyTextStyle`, `shadowFilter`, `applyConfig`, `fitHeadline`, `fitCapLabel`, `placeOrbitCenter`, `buildScene`, `renderItem`, `burst`, `parseEmbed`, `openMedia` | Turns a config object into the page. **`applyConfig(c)` is the single entry point** |
| Button beat | `applyBeat`, `beatListen`, `beatFrame`, `spawnBeat`, `drawSpectrum`, `lighten`, `updateParticles`, `clearParticles` | Beat engine: rings/EQ/halo/shock/visualizer, particles, background shake |
| Soundtrack | `spotifyEmbed`, `renderSoundtrack`, `audioPlayer`, `setVolume`, `setPlayer` | Music button + player card (Spotify embed, or our own `<audio>` player) |
| Live data | `render`, `renderViewers`, `renderPlate` (lower third), `renderTicker` (crawl), `renderStats`, `tick`, `renderChart` | Everything driven by server state. `tick()` runs every second |
| History | `episodes`, `thumb`, `episodeRow`, `episodeBody`, `renderHistory` | The "Previously on" popup |
| Ownership | `myOwnership`, `showWon`, edit-link claim IIFE | Private edit links (`/#edit=<token>.<since>`) |
| Wizard | `setStep`, `setAdvTab`, layer card functions, logo helper, link rows, uploads (`shrinkImage`), `readForm`, `fillForm`, `syncFormUi`, `onFormInput`, validation (`badLinkIn`, `validateStep`, `showError`), `openWizard`, `endWizard`, `resumeWizard` | Guided bid/edit flow |
| Button, dock, reactions | `post`, `clickSound`, `ring`, `setTray`, `spawnReaction`, `takeoverMoment`, `toast`, share/report handlers | Interactions |
| Live connection | `connect`, `boot` | SSE wiring, first visit ping, Stripe return handling |

### `public/style.css`, section order

Tokens → buttons → slanted tags → stage → background filters and animated FX → background overlay/grain → owner text effects → **the button** → button beat FX → broadcast stage layout → scene layers, shapes, motions and burst → CRT glass → static → BREAKING banner → channel chrome (bug, ON AIR, live count) → lower third → news crawl → dock → soundtrack player → audio player → popups → stats → history → how it works → media → receipt → forms → wizard → Text-tab sections → filter tiles → layer cards → toasts → responsive (≤899px, ≤640px) → `prefers-reduced-motion`.

---

## 5. Server architecture

### HTTP API

| Route | Purpose | Rate limit (per IP) |
|---|---|---|
| `GET /api/state` | Public state snapshot | none |
| `GET /api/stream?vid=…` | SSE stream. Viewer count = unique `vid`s, so tabs count once. Ping every 25 s. Cap 10,000 clients | none |
| `POST /api/hello {vid}` | Counts a page view (visits, unique visitors, the current owner's impressions) | 30/min |
| `POST /api/click` | The owner's button was pressed | 1 per 2 s |
| `POST /api/react {emoji}` | Broadcasts a reaction (🔥 😂 😍 👏 🤯 💸) | 8 per 4 s |
| `POST /api/report` | Report the current owner (one per IP per reign) | once |
| `POST /api/bid {name, amount(cents), config}` | Demo: instant takeover, returns `{token, since}`. Stripe: creates a Checkout session and returns `{checkoutUrl}` | 6/min |
| `POST /api/checkout/confirm {sessionId}` | Verifies the Stripe session, applies the takeover, or **auto-refunds** if someone outbid them mid-payment. Guarded against double-apply | none |
| `POST /api/upload` (raw body) | Images (PNG/JPG/GIF/WebP, ≤ 2 MB) or audio (MP3/M4A/OGG/WAV, ≤ 8 MB). **Type is sniffed from file bytes; SVG is refused.** Stored as `/u/<sha256>.<ext>` | 30 per 10 min |
| `POST /api/edit {token, config}` | The current owner restyles without re-bidding (token is checked against a SHA-256 hash) | 20/min |
| `GET /api/admin` | Reports/pending/clients. Needs the `x-admin-key` header | admin |
| `POST /api/admin/takedown` | Wipes the owner's content but keeps ownership and price | admin |
| `GET /u/<hash>.<ext>` | Serves uploads with **byte-range support** (Safari needs it for audio), immutable cache, `nosniff`, `CSP: default-src 'none'; sandbox` | none |

### SSE events

| Event | Payload | When |
|---|---|---|
| `state` | full public state | On connect; throttled to ≤ 1/s after stat changes; immediately after edit or takedown |
| `viewers` | `{viewers, peakViewers}` | Connect/disconnect (debounced 400 ms) |
| `takeover` | `{previous: {name, since}, state}` | Someone took the button |
| `react` | `{emoji}` | A reaction was sent |

### Persisted state (`data/state.json`)

```js
{
  current: { name, amount, since, config, clicks, impressions, reactions, reports, tokenHash } | null,
  history: [ { name, amount, since, until, clicks, impressions, reactions,
               headline, swatch, link, look } ],     // oldest first, max 1000 kept
  bids:    [ { name, amount, at } ],                  // every takeover, max 500 kept
  pending: { [pid]: { name, amount, config, createdAt, status, token?, since?, error? } },  // Stripe
  visitors: [vid, …],                                 // unique visitor ids
  stats: { totalVisits, peakViewers, peakAt, totalClicks, totalRaised, totalReactions, totalBids, firstBid }
}
```

`look` (saved per history entry, used for History thumbnails) = `lookOf(config)`: bg type and colors, gradient style/position, image fit/position, text color, font, headline, button colors and text. Entries saved before this existed have `look: null`, and the client falls back to `swatch`.

### Public state (sent to clients)

`{ mode, currency, now, minNextBid, viewers, owner{name, amount, since, clicks, impressions, reactions}, config, history (last 100, newest first), bids (last 30), stats{…, uniqueVisitors, owners, longestReign} }`.

`now` is used to correct client clock skew (`clockOffset`).

### Pricing

`minNextBid = current.amount + max(MIN_STEP, ceil(amount × MIN_STEP_PCT%))`, or `START_PRICE` when unowned.

---

## 6. The page config (owner's design)

Every owner design is one flat `config` object. **All fields are validated in `cleanConfig()`** in [server.js](server.js). The client mirrors defaults in `TEXT_DEFAULTS`, `BG_STYLE` and `BEAT_STYLE` (in [app.js](public/app.js)) so older saved pages still render.

### Content and button
| Field | Type / range | Default | Where in UI |
|---|---|---|---|
| `headline` | text ≤ 80 | "This button is for sale." | Wizard step 2 |
| `tagline` | text ≤ 220 | … | Step 2 |
| `buttonText` | text ≤ 32 | "Buy me" | Step 2 |
| `buttonColor`, `buttonTextColor`, `textColor` | hex | red / white / off-white | Step 2 colors |
| `linkUrl` | http(s) URL | "" | Step 3 ("Where a press takes people") |
| `embedUrl` | URL or upload | "" | Step 3: YouTube / Vimeo / Spotify / video / image / link → a **chip under the button** that opens the media popup |
| `links` | ≤ 4 `{label ≤ 30, url}` (UI shows 3) | [] | Step 3 extra links |

### Text (Customize more → Text)
`font` (8: Big Shoulders Display, Bebas Neue, Inter, Playfair Display, Space Mono, Pacifico, Press Start 2P, Permanent Marker) · `headlineSize` 60–160% · `taglineSize` 70–150% · `letterSpacing` −5…30 · `uppercase` · `textFill` solid/gradient + `textColor2`, `textGradAngle` · `textStroke` 0–6 px + `strokeColor` · `textShadow` none/soft/glow/hard/extrude + `shadowColor` · `textAnim` none/shimmer/pulse/flicker/float.

The headline **auto-shrinks** (`fitHeadline`) to fit 3 lines without splitting words, so the chosen size is a maximum.

### Background (Customize more → Background)
- `bgType`: **solid, gradient, mesh, image**. Video was removed on request; the server now rejects it.
- Gradient: `gradStyle` linear/radial/conic, `bg1`, `bg2`, optional middle `bg3` (`bg3On`), `bgAngle`, `gradPos`.
- Mesh: base `bg1` + glows `bg2`, `bg3`.
- Image: `bgImage` (URL or upload), `bgFit` cover/contain/tile, `bgPos`, `bgBlur` 0–20, `bgBright` 40–150.
- **Filter** (images): `bgFilter`.
  - Clean: vivid, noir, vintage, cinematic, faded, warm, cool, dreamy.
  - "Unhinged": acid (animated), deepfried, glitch (animated), thermal, xray, invert, posterize, duotone (`duoDark`/`duoLight`), liquid (animated SVG displacement), vhs (animated).
- Motion: `bgAnimate` + `bgSpeed` (gradient/mesh drift; Ken Burns zoom on images).
- Overlay: `overlayColor` + `overlayOpacity` (0–0.85), `vignette` 0–100, `grain` 0–100.
- Texture: `texture` none/dots/grid/stripes/checker/waves + `textureColor`, `textureOpacity`, `textureScale`.
- **Soundtrack:** `audioSource` spotify/file.
  - `bgAudio`: must be an `open.spotify.com/{track|album|playlist|episode|show|artist}/…` link.
  - `audioFile`: upload or URL, with `audioVolume` 0–100 as the starting volume.

### Scene layers (Customize more → Layers)
`layers`: up to 4 of `{ kind: image|text|shape|emoji, value, color, motion: float|rain|rise|orbit|bounce|drift|spin|pulse|still, count 1–40, size 10–260, speed 0.25–3, opacity 0.1–1, blur 0–16, spin }`.
- Shapes: circle, ring, square, diamond, triangle, star, heart, blob.
- Layer 1 is the back layer and the **burst** layer.
- The wizard's **"Your logo"** field is a shortcut that writes image layer 1.
- Legacy `floaters` data is converted by `legacyLayers()`.

### Effects (Customize more → Effects)
- **Button beat:** `beatStyle` none/rings/bars/halo/shock/**trap** (the "Visualizer"), `beatMatch` (use button color) or `beatColor`, `beatBpm` 60–180, `beatIntensity` 20–100, plus `beatShake` and `beatParticles` (these two work with any style).
- Layer effects: `parallax`, `burst`.
- Backdrop pattern: `patternUrl` (URL or upload), `patternSize`, `patternOpacity`.

---

## 7. How the client renders

1. `connect()` opens SSE and receives `state` → `render(state)`.
2. `render()` updates the numbers, the lower third, crawl, stats, chart and history, then calls **`applyConfig(state.config)`**. It skips this while the wizard is previewing or during a takeover wipe.
3. `applyConfig(c)`: `applyBackground` → `renderSoundtrack` → `applyBeat` → CSS vars (`--owner-text`, `--owner-font`, `--btn-bg`, `--btn-fg`) → headline/tagline + `applyTextStyle` → cap label → link and media chips → `buildScene` (only if layers changed) → next frame: `fitHeadline`, `fitCapLabel`, `placeOrbitCenter`.
4. **Wizard preview:** every form input → `onFormInput()` → `readForm()` → `applyConfig(draft)`, so the page behind shows the draft live. The draft is saved to `localStorage.tb_draft`. Closing the wizard restores `S.config`.
5. **Takeover:** static burst (`#static`) + circular wipe of the new background from the button (`#wipe`) + BREAKING banner (`#sold`) + toast ("X outbid you…" if it was yours).

### DOM layers inside `#stage` (bottom to top)
`#bgWrap > #bg` (background; filters on the wrapper, motion on `#bg`) → `#bgFx` (texture, vignette, tint) → `#bgGrain` → `#pattern` → `#vizParticles` (canvas) → `#floaters` (scene layers) → `#wipe` → `#content` (headline, tagline, `#housing > .beat + #theButton`, owner links) → BREAKING banner → preview tag. Above the stage: `.crt` (scanlines/vignette/tracking band, z 20), `#static` (z 22), channel chrome (z 30).

### Beat engine (`beatFrame`, every animation frame when active)
- **Real music:** an uploaded soundtrack (same-origin `/u/…`) is routed through a Web Audio `AnalyserNode` (fftSize 1024) on the first Play click. Bass energy in bins 1–4 (~40–200 Hz) is compared to a running average for relative, **volume-independent** hit detection (≥ 240 ms apart).
- **Circular spectrum:** 48 log-spaced bands, **each normalised to its own recent peak** so the whole ring moves, then mirrored to 96 points. Drawn as 3 trailing layers (history frames 4, 2, 0) on a canvas, hollow in the middle.
- **Tempo mode:** used for Spotify, linked files, or before play. A synthetic envelope at `beatBpm` plus a believable bass-heavy fake spectrum.
- Drives the CSS var `--beat` on `#beat` and `#housing` (button punch), `--lv` per EQ bar, spawns `.beat-ring` / `.beat-shock`, draws particles, and shakes the background via `translate`/`scale` on `#bgWrap`. These are individual transform properties, so they don't fight filter animations.
- Disabled under `prefers-reduced-motion`.

---

## 8. UI and UX structure

### The screen (no page scroll)
```
[channel logo: colour bars · THE BUTTON · CH 01] [DEMO]      [● ON AIR] [N watching] [Edit page] [BID $X]
                              HEADLINE (owner font/effects)
                              tagline
                           ( sleek glossy button in metal rim )   ← beat FX around it
                           [owner links] [▶ Watch video]
[NOW ON AIR / name / Paid $ · on air t]              [Stats · History · How it works | Music · React · Share]
[LIVE] ◆ news crawl of takeovers … ◆                                                   [HH:MM:SS]
```
On ≤ 899px the dock centres and the lower third moves above it. On ≤ 640px labels are trimmed, popups become bottom sheets, and the button is sized from the viewport width.

### Popups (`<dialog class="pop">`)
- **Stats** (`#statsPop`): hero card tinted in the owner's color (price, owner, held-for clock, watching), This-reign tiles (views, presses, press-rate gauge, reactions), price chart (step line, takeover dots, glowing "now" dot, hover tooltip, time axis), All-time grid.
- **History** (`#historyPop`, "Previously on"): summary strip; sort (Latest / Top bids / Longest / Presses); search (≥ 6 entries); **episodes** (EP number, page thumbnail, badges NOW / YOU / TOP BID / LONGEST / MOST PRESSED / RAISED OWN BID, price and % jump). Each expands to a detail list plus metrics and a Visit link. Open state survives live re-renders (`openEpisodes`).
- **How it works** (`#howPop`): 4 steps + demo/Stripe note + Report link.
- **Media** (`#mediaPop`): the player loads on open and is **removed on close**, so playback stops.
- **Receipt** (`#wonDialog`): "You're on air.", details, private edit link + Copy.
- **Wizard** (`#bidPop`): see below.

### Guided bid wizard
1. **Your bid:** name, amount, raise chips (Min / +10% / +25% / +50%). Centred with a dimmed backdrop.
2. **Your look:** 8 themes, "Your logo", headline, tagline, button text, 3 colors, and **Customize more** (in-popup advanced view with tabs **Background · Text · Layers · Effects**, each divided into titled sections).
3. **Link & media:** press link, featured media (+ detection hint), extra links, summary, **Take it for $X**.

- From step 2 on (desktop ≥ 900px) the popup becomes a **420px side card** with a transparent backdrop, so the live preview is visible. The dock, lower third and top-right chrome fade out.
- On mobile, **Preview** hides the sheet and **Back to editing** restores it (`peeking`).
- **Edit mode** (current owner): skips step 1, steps are numbered 1–2, and the action is **Save changes**.
- Validation errors jump to the step or advanced tab containing the field.

### UI conventions used in markup
Visibility is driven declaratively in `syncFormUi()`:

| Attribute | Shown when |
|---|---|
| `data-show="solid gradient …"` | `bgType` is one of the listed values |
| `data-grad="linear conic"` | `gradStyle` matches |
| `data-fill="gradient"` | `textFill` matches |
| `data-audio="spotify\|file"` | `audioSource` matches |
| `data-needs="field"` | That field is non-empty |
| `data-when="stroke\|shadow\|texture\|bganim\|duo\|beat\|beatcolor\|audiofile"` | Custom rules |
| `data-kind` | Layer-card kind matches |
| `data-url="web\|upload\|spotify\|audio"` | Which link validation applies (`badLinkIn`) |

- Section structure: `<section class="field text-group"><h3 class="sec-title">…</h3>…</section>` inside `.adv-pane.sectioned`.
- Upload buttons: `data-upload="<fieldName>"`, or a bare `data-upload` inside a layer card. The file picker's `accept` switches to audio for `audioFile`.

### localStorage keys
`tb_vid` (visitor id) · `tb_owner` `{token, since}` (ownership, enables "Edit page") · `tb_mine` (since-values of your reigns → YOU badge) · `tb_draft` (wizard draft) · `tb_volume` (visitor's chosen soundtrack volume).

---

## 9. Design system: "retro-futurist broadcast"

- **Palette:** navy `#0a1433` / `#101d47` / `#182a63`, well `#070f29`, text `#f3f6ff`. Signal red `#e8262b` (ON AIR, LIVE, BREAKING, NOW), scoreboard yellow `#ffd23f` (primary actions, figures), data cyan `#3fe0ff` (charts, icons). SMPTE colour-bar gradient (`--bars-h`, `--bars-v`).
- **Type:** Barlow Condensed (headings, labels, figures: uppercase, often italic), Barlow (body, 16px), Share Tech Mono (numbers, timecodes). Owner fonts are loaded separately.
- **Motifs:** slanted parallelogram tags (`clip-path: var(--slant)`), yellow-bar section headings (`h3`), colour-bar stripe on top of every popup, scanlines, CRT vignette, VHS tracking band, lower thirds.
- **The button:** sleek build (latest). A brushed-metal conic **rim**, a dark recessed **groove** (`.housing::before`), a glossy **cap** (84% width) in the owner's color with a top gloss, bounce light and a `::after` specular reflection, and an ambient glow in the owner's color. The press is a short click (`scale(.975)`). The label auto-fits (`fitCapLabel`, 66% width room).
- **Readability rule:** owner words (`#headline`, `#tagline`, `.owner-links`) sit at z-index 2, above all beat and particle effects.

### Themes (presets in app.js)
Cola Blue, Neon Night, Sunset, Gold Rush, Forest, Space, Paper, Graffiti.
- Each sets colors, font, a multi-layer scene, and some text, background and beat effects. Examples: Neon Night = flicker glow + grid texture + **trap visualizer with shake and particles**; Gold Rush = gradient 3D text + halo beat; Space = drifting mesh.
- Presets are merged over `TEXT_STYLE`, `BG_STYLE` and `BEAT_STYLE` defaults, so switching themes resets the effects. Uploaded image layers and text sizes are kept.

---

## 10. Security notes

- **CSP (pages):**
  - `default-src 'self'`, `script-src 'self'`.
  - Styles: self + inline + Google Fonts.
  - `img-src *`, `media-src *`.
  - `frame-src`: youtube-nocookie, player.vimeo.com, open.spotify.com only.
  - `connect-src 'self'`, `object-src 'none'`, `base-uri 'none'`.
- **Uploads:**
  - Content-sniffed (images: PNG/JPEG/GIF/WebP magic bytes; audio: ID3/MPEG sync, `ftyp`, `OggS`, `RIFF…WAVE`).
  - Content-hash filenames; path regex check (no traversal); served with a sandbox CSP; cap of 5000 files.
- **Other protections:**
  - Owner text is always set via `textContent`.
  - URLs are restricted to http(s) (plus `/u/` upload paths where allowed); colors must be hex.
  - Edit tokens are stored hashed and compared with `timingSafeEqual`.
  - Per-IP rate limits; `X-Forwarded-For` is trusted (put the app behind a proxy you control).
- **Stripe:** the takeover is applied only after the server verifies `payment_status === 'paid'` and the amount matches. If someone outbid them mid-checkout, the server issues a refund.

---

## 11. Testing workflow (how changes were verified)

- **Never test against the live auction** (port 4321). The user bids on it themselves and cares about that data.
- Run a **throwaway server**:
  ```bash
  DATA_DIR=<scratch>/testdata PORT=4322 node server.js &
  ```
  Seed it with `curl -X POST localhost:4322/api/bid -H 'Content-Type: application/json' -d '{"name":…,"amount":…,"config":{…}}'`. Kill it and delete the test data afterwards.
- Generate test media with Python (stdlib only): PNGs via zlib, WAV tones or trap beats via the `wave` module. Upload with `curl --data-binary`.
- **Browser pane quirks:**
  - Screenshots often lag one step behind; re-take, or verify with JavaScript state reads.
  - Large emulated viewports get scaled down in the capture.
  - When the pane is in the background, `document.hidden` is true and `requestAnimationFrame` is throttled (≈1 fps). To test the beat engine, override `document.hidden` and call `beatFrame(t)` manually with synthetic timestamps.
  - `dialog` `close` events are async, so wait before asserting.
- Preview-only visual checks: call `applyConfig({...S.config, …})` in the page, which nothing saves, then reload.
- `node --check server.js public/app.js` before every restart.

---

## 12. Known limitations and gotchas

- **Autoplay:** browsers block pages from starting sound, so every soundtrack needs a visitor's Play click.
- **Spotify:**
  - It can't be volume-controlled or analysed by the page; there's no API for it.
  - It plays 30-second previews to visitors who aren't logged in.
  - The player shows a note: "Volume follows your device."
- **Beat sync with real music** works only for **uploaded** audio files. Linked audio from other sites can't be analysed (routing it through Web Audio without CORS would silence it).
- **Background video** was removed by request. The featured-media popup can still play video files.
- **SVG filters** (Thermal, Duotone, Posterize, Liquid, Warm, Cool) are weaker or missing in Safari.
- **Stripe:** payments are confirmed when the buyer returns to the site. For production, add a `checkout.session.completed` webhook.
- **Scaling:** single process + JSON file. Scaling out needs Postgres/Redis and Redis pub/sub for SSE fan-out.
- **Uploads** are never garbage-collected (unused files stay in `data/uploads/`).
- **Moderation** is manual (report counter + admin takedown). There is **no automated content filtering**, and owners can upload any image, including adult content.
- **README vs code:** the README says "up to 3 extra links"; the server accepts 4, but the UI offers 3.
- The history keeps the last 100 entries publicly (1000 stored).

---

## 13. Build history (what the user asked for, in order)

1. **Original ask:** a one-page site where people bid to own a button; the owner customizes the page (colors, floating items, links, video) as an advertising spot; show live viewers and other metrics; add anything worthwhile. First version: dark glass dashboard, SSE, JSON persistence, Stripe-ready.
2. "UI looks like shit" → **"The console"** redesign (industrial control panel, dot-matrix amber displays).
3. Replace emoji-only floaters with brand-customizable content → **scene layers** (image, text, shape, emoji) + uploads + parallax + burst + logo pattern.
4. "UX is very bad, cluttered, not classy, use popups instead of scrolling" → **quiet luxury, one screen**, popups, **guided 3-step wizard** with a side-card live preview. (User picked "Quiet luxury" and "Guided 3 steps".)
5. **Stats popup** made more visual (hero card, tiles, gauge, chart with tooltips). Fixed a stale-chart bug: SVG ignores the `.hidden` property.
6. "Slightly retro futuristic" → space-age tweaks, which the user called **too subtle** → full **retro-futurist TV broadcast** theme (the current one).
7. **History** rebuilt as episodes with detail lists, sort, search and badges; the server stores each owner's look and link.
8. **Text:** font sizes + gradient, outline, shadow and animation effects. Then "no hierarchy in the Text tab, don't change UI, only fix that" → titled, divided sections.
9. **Background tab** upgraded after researching common tools: gradients, mesh, image fit/adjust, motion, overlay, textures.
10. **Image filters**, "good and unhinged".
11. Removed **video background**; added a **Spotify soundtrack**.
12. **Volume control** → the user chose "Add audio files with volume" (own player, owner's default volume, visitor slider/mute remembered). Later: "can't decrease volume on Spotify" → explained the platform limit and added an in-player note.
13. **Beat effects** around the button (rings, EQ, halo, shock), synced to uploaded audio.
14. "Like trap songs on YouTube" → **Visualizer** (Trap-Nation-style circular spectrum), button punch, background shake, particles.
15. "Give the button a very sleek design" → metal rim, groove, glossy cap, glow, short click.
16. Data was reset once on request ("delete the current data"); the user has kept bidding on the live server since (owners like "halycon", "genesis", "abyss").

---

## 14. Working agreements (user preferences learned)

- The user wants **bold, finished, professional** visuals. "Too subtle" gets rejected; "cluttered" gets rejected. They like strong themes with clear hierarchy.
- **One screen, no page scrolling**; popups and sheets for everything else.
- When they say **"don't change the UI, only solve X"**, change only what's needed for X.
- Always **verify visually** and on **mobile (375px)**; report issues found and fixed.
- **Protect the live auction data** on port 4321; test on a throwaway `DATA_DIR` server.
- Be upfront when something is **impossible** (Spotify volume, autoplay) and offer the nearest workable alternative. Ask when there's a real product choice (the user answered option prompts twice).
- Keep [README.md](README.md) updated with each feature.
- "Start the project" means: run the `the-button` preview (`npm run dev` on 4321) and confirm it loads.

---

## 15. Ideas and next steps (not built)

- Stripe webhook for payment confirmation; Stripe test-mode walkthrough.
- Content moderation: automated image checks, or a review queue for uploads; a proper admin UI instead of curl.
- Upload garbage collection (delete files no current or historical config references).
- Persistence upgrade (SQLite/Postgres) and multi-instance SSE fan-out.
- OG image generation of the current owner's page for social sharing.
- Countdown or "reign timer" mechanics, bid notifications (email/push) for outbid owners.
- Accessibility pass on the beat/visualizer (a visitor-side "calm mode" toggle in addition to reduced motion).
- Git init + deploy (Render/Fly/Railway); the project currently lives in a session scratch folder with no version control.
