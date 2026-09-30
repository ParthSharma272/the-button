# The Button

One button. One owner. Outbid whoever owns it and the whole page becomes yours: background, colors, font, floating emoji or product images, the button's text and link, a featured video, song or site, and extra links. You keep it until someone outbids you.

## Run it

```bash
npm start
```

Open http://localhost:4321. Node 18+ is the only requirement; there are no dependencies to install.

By default it runs in **demo mode**: bids are accepted without payment, which is useful for testing and launch hype.

## Features

**The design: one screen, no scrolling**
The owner's page fills the whole screen. The site itself is just a thin layer of frosted glass on top: a top bar (live viewers, **Bid**, and **Edit page** for the owner) and a small dock (**Stats · History · How it works · React · Share**). Everything else opens as a popup, which becomes a bottom sheet on phones.
- The arcade button is the one signature element. It presses down, clicks, sends a ring outward, and its label shrinks to fit any font.
- A small glass pill under the button shows the owner, what they paid, and how long they've held it.
- When someone takes over, the new owner's page wipes outward from the button while a "Sold" card fades through.
- **Style: a retro-futurist TV broadcast.** The Button is a live channel, and whoever owns the button owns the airtime.
  - **Channel logo** with a test-card colour bar and "CH 01", plus a blinking red **ON AIR** tag.
  - A **lower-third caption** names who's on air, what they paid and for how long.
  - A **news ticker** runs takeovers along the bottom, with a live clock.
  - The picture is behind **CRT glass**: scanlines, a vignette and a rolling tracking band.
  - When someone takes over, a burst of **static** is followed by a **BREAKING** banner.
  - Popups are on-air graphics panels: a colour-bar stripe, condensed italic titles, scoreboard-yellow figures and cyan data.
  - Type: Barlow Condensed for headings and figures, Barlow for body text, Share Tech Mono for timecodes.

**Bidding: a guided 3-step popup**
1. **Your bid:** name and amount, with quick-raise chips (Minimum / +10% / +25% / +50%).
2. **Your look:** 8 themes, your logo or product image (it floats and bursts out of the button), headline, tagline, button text and colors. **Customize more** opens background, typeface, floating layers and effects without leaving the popup.
3. **Link & media:** where a press goes, a featured video, song or image (the hint tells you what your link will become), extra links, and a summary before you pay.

- After step 1, the popup moves to the side on desktop so you design against the live page. On phones, **Preview** hides the sheet and **Back to editing** brings you back to the same step.
- Mistakes are caught on the step where they happen. Your draft is remembered, so if you're outbid you can take the button back quickly.
- The minimum next bid is always the current price plus 5% or $1, whichever is larger (configurable).
- Winners get an **ownership receipt** with a private edit link (`/#edit=…`). Owners edit through the same popup, starting at "Your look".

**What an owner can customize**
- Headline, tagline, typeface (8 choices), text color
- **Text size and effects** (Customize more → Text):
  - Headline and tagline size, letter spacing, all capitals
  - Gradient fill with a second color and direction
  - Outline with thickness and color
  - Shadow: soft, glow, hard or 3D, in any color
  - Animation: shimmer, pulse, flicker or float
  - The headline shrinks automatically if a big size won't fit, so it's never cut off or split mid-word
- **Background** (Customize more → Background):
  - **Type:** solid, gradient (linear, radial or conic, 2 or 3 colors, angle and center), mesh (soft aurora glows), or image
  - **Image:** upload or link, fit (fill, whole image, tile) and focus point
  - **Adjust** images: blur and brightness
  - **Filters** for images, each shown as a live preview tile of your own image:
    - Clean: Vivid, Noir, Vintage, Cinematic, Faded, Warm, Cool, Dreamy
    - Unhinged: Acid (endless color cycling), Deep fried, Glitch, Thermal, X-ray, Inverted, Posterize, Duotone (your two colors), Liquid (the image melts and warps) and VHS
  - **Motion:** slowly drifting gradient colors, or a slow Ken Burns zoom on images
  - **Overlay:** color tint, vignette and film grain, which keep text readable over busy images
  - **Texture:** dots, grid, stripes, checks or waves, with color, strength and scale
  - **Soundtrack:** a **Music** button appears in the dock and opens a player. Browsers don't let pages start sound by themselves, so visitors press play. Closing the player doesn't stop the music. Two sources:
    - **Spotify:** paste a song, album, playlist or podcast link. Spotify doesn't let pages control its volume, so it follows the visitor's device.
    - **Audio file:** upload an MP3, M4A, OGG or WAV (up to 8 MB) or link to one. It loops in our own player with play/pause, seek, mute and a **volume slider**. The owner sets the starting volume, and each visitor's own volume choice is remembered in their browser.
- Button text, cap and label colors, and where a press goes
- **A branded scene** of up to 4 layers stacked behind the page. Each layer is one of:
  - **Image:** upload your logo, product shots (bottles, sneakers…) or a photo, or paste a link
  - **Text:** your brand name or a slogan, in your typeface and color
  - **Shape:** circle, ring, square, diamond, triangle, star, heart or blob, in your color
  - **Emoji**
- Every layer has its own motion: hover, rain, rise, drift across, orbit the button, bounce, spin in place, pulse or still. It also gets its own count, size, speed, opacity, blur (for depth) and an optional spin.
- **Effects:** layers follow the cursor with parallax (back layers move less), and pressing the button bursts layer 1 out of it.
- **Button beat** (Customize more → Effects): animated effects around the button that pulse to a beat. Choose Rings, EQ, Halo, Shock or **Visualizer**, with color (or match the button), tempo and intensity.
  - **Visualizer** is the circular spectrum from trap and bass music channels. It's a mirrored, spiky ring of frequencies drawn in trailing glow layers around the button, and the button punches bigger on every bass hit.
  - Two extras work with any style: **shake and zoom the background on the bass**, and **particles streaming out** from the button, faster on each hit.
  - With an uploaded soundtrack playing, the effect follows the real music by detecting the bass hits in the audio.
  - Otherwise, including with Spotify (which can't be analysed), it pulses at the owner's tempo.
  - It's switched off for visitors who've turned on "reduce motion".
- **Backdrop pattern:** tile an image, like your logo, across the whole background, with adjustable size and strength.
- Featured media: a chip under the button ("Watch video", "Listen", "View image") opens YouTube, Vimeo, Spotify, video files or images in a popup. Closing it stops playback. Any other link becomes a link chip.
- Up to 3 extra link buttons

**Live metrics** (pushed to every viewer in real time over Server-Sent Events)
- Watching now (unique browsers, so tabs count once), price paid, price to take it, and how long it's been held
- This reign: page views, presses, press rate and reactions (the numbers an advertiser cares about)
- All time: total raised, owners, visitors, peak watching, longest reign, price growth
- All of this is in the **Stats** popup, with a price chart.
- **History** ("Previously on"):
  - A summary strip: takeovers, owners, top bid, longest reign.
  - Sort by latest, top bids, longest reign or presses, and search by name once there are 6 or more.
  - Every reign is a numbered episode with a thumbnail of that owner's page, what they paid and the % jump. Badges mark **Now**, **You**, **Top bid**, **Longest**, **Most pressed** and **Raised own bid**.
  - Tap an episode for the full details: when they took over, on air from → to, who they took it from and lost it to, their headline, views, presses, press rate and reactions, and a link to their site.

**Extras**
- A reaction tray in the dock that floats emoji up on everyone's screen
- A "you've been outbid" alert for the previous owner
- Share button, report button, and admin takedown for moderation
- Keyboard-friendly popups (Esc closes them and focus returns where you were), and "reduce motion" respected

## Taking real money (Stripe)

```bash
STRIPE_SECRET_KEY=sk_live_... BASE_URL=https://yourdomain.com npm start
```

With a key set, bids go through Stripe Checkout. The page changes hands only after the server confirms the payment with Stripe. If someone else takes the button while a bidder is on the payment page, that bidder is **refunded automatically**. Use an `sk_test_...` key first.

> For production, also add a Stripe webhook for `checkout.session.completed`. Currently payments are confirmed when the buyer returns to the site, so a buyer who closes the tab mid-redirect has paid but isn't applied until they revisit the return URL.

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | `4321` | HTTP port |
| `BASE_URL` | `http://localhost:PORT` | Public URL (used for Stripe redirects) |
| `STRIPE_SECRET_KEY` | none | Enables real payments |
| `CURRENCY` | `usd` | Stripe currency code |
| `START_PRICE_CENTS` | `100` | First bid ($1) |
| `MIN_INCREMENT_CENTS` | `100` | Minimum raise ($1) |
| `MIN_INCREMENT_PCT` | `5` | Minimum raise as % of the current price |
| `ADMIN_KEY` | none | Enables the moderation endpoints |

## Uploads

Owners can upload PNG, JPG, GIF or WebP images (up to 2 MB) and MP3, M4A, OGG or WAV soundtracks (up to 8 MB). The browser shrinks large photos before sending them. The server checks the file's actual bytes (it refuses SVG and anything disguised as an image) and stores each file under its content hash in `data/uploads/`, served from `/u/…`. Images uploaded for a design that never gets bid on stay on disk; clear out `data/uploads/` occasionally if that matters to you.

## Moderation

Anyone can post anything, so keep moderation handy:

```bash
curl -H "x-admin-key: $ADMIN_KEY" localhost:4321/api/admin
curl -X POST -H "x-admin-key: $ADMIN_KEY" localhost:4321/api/admin/takedown
```

The takedown wipes the owner's content but leaves the price, so anyone can still outbid them. User content is sanitized server-side: only `http(s)` links, hex colors, whitelisted fonts, and length limits. A strict Content-Security-Policy only allows iframes from YouTube, Vimeo and Spotify.

## How it's built

- `server.js`: plain Node `http`. It serves the page, runs the JSON API and SSE stream, validates everything, rate-limits per IP, and persists to `data/state.json`.
- `public/index.html`, `style.css`, `app.js`: framework-free front end.

This is a single process with a JSON file, which is plenty for thousands of concurrent viewers on one small VPS (Render, Railway, Fly.io). To scale past one instance, move state to Postgres or Redis and fan the live events out through Redis pub/sub.
