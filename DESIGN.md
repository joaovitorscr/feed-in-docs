---
version: "alpha"
name: "Monzoo"
description: "Friendly neobank: mint paper, deep navy ink, one hot coral card, 64px-rounded photo panels and heavy rounded headlines on navy pill buttons."
colors:
  primary: "#ff4f40"
  on-primary: "#ffffff"
  surface: "#ffffff"
  surface-container: "#f2f8f3"
  on-surface: "#091723"
  on-surface-variant: "#6b747b"
  outline: "#e6e8e9"
  navy: "#112231"
  mint-2: "#e3ebe4"
  sun: "#ffb000"
  photo-lit: "#c9793e"
  photo-dark: "#241510"
  leaf: "#4f7b33"
  sky: "#5a86b8"
typography:
  headline-display:
    fontFamily: "Onest"
    fontSize: 56px
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: -0.022em
  headline-lg:
    fontFamily: "Onest"
    fontSize: 39px
    fontWeight: 800
    lineHeight: 1.2
  headline-md:
    fontFamily: "Onest"
    fontSize: 25px
    fontWeight: 700
    lineHeight: 1.4
  body-lg:
    fontFamily: "Onest"
    fontSize: 20px
    fontWeight: 400
    lineHeight: 1.4
  body-md:
    fontFamily: "Onest"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.4
  label-md:
    fontFamily: "Onest"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1
rounded:
  sm: 8px
  md: 16px
  lg: 32px
  xl: 64px
  full: 500px
spacing:
  unit: 8px
  section: 128px
  max-width: 1312px
---

# Monzoo

> A UK neobank homepage: white and pale-mint paper, near-black navy ink, one hot coral colour for cards and wordmark, and every surface a big soft rounded slab.

Source: https://flavors.design/f/monzoo

One face does everything: **Onest**, a heavy, round geometric sans with a single-storey u-shaped `y` and an open `a`, at 800 for headlines and 400–600 for text.

## Overview

Monzoo is a bank that talks like a friend who is good with money. The page is mostly white with pale mint (`#f2f8f3`) panels; ink is a deep navy (`#091723`), never black; and one hot coral (`#ff4f40`) does all the shouting: the wordmark, the card itself, half the feature tiles and the giant footer wordmark. Everything is soft: 64px corners on hero and section panels, 32px on cards, 500px pills on every button. Headlines are extra-bold, slightly tight, sentence case, and short; body copy is 60% navy and conversational. Photography is warm, candid lifestyle (dinner, picnics, travel) cropped into rounded panels, alternating with flat coral tiles holding a floating piece of app UI.

It is for consumer fintech, neobanks, budgeting apps and anything that wants to feel regulated but human. It is not corporate-bank blue, not crypto-neon, not glassmorphism; there are almost no shadows and no gradients except inside illustrations.

## Colors

| Role       | Value | Notes |
| ---------- | ----- | ----- |
| bg         | `#ffffff` | page |
| bg-2       | `#f2f8f3` | mint panels, account cards, locale strip, nav segment, FAQ hover |
| fg         | `#091723` | headlines, primary buttons, outlines |
| ink        | `#091723` | text on white surfaces (white pills, burrow tiles, seals); stays dark when a scheme flips `fg` light |
| fg-muted   | `#6b747b` | token for muted text; in CSS the page uses `color-mix(fg 60%)` |
| accent     | `#ff4f40` | wordmark, coral tiles, the card, "Step 1", rank highlights |
| accent-fg  | `#ffffff` | text on coral and navy |
| border     | `color-mix(in srgb,var(--fg) 10%,transparent)` | disabled icon-button rings, footer rule |
| navy       | `#112231` | inverse panels: CTA, footer, highlighted pricing, navy tiles |
| mint-2     | `#e3ebe4` | chart tracks, inverse hover |
| sun        | `#ffb000` | card chip, warm glow in carousel media stand-ins |
| photo-lit / photo-dark / leaf / sky | `#c9793e` / `#241510` / `#4f7b33` / `#5a86b8` | photo-dark is the hero scrim and the backdrop under the photo; the rest only tint small carousel media tiles |

Scheme: light. Contrast rule: navy on white ≈ 18:1; muted text is navy at 60% (≈ 5:1). White type only on coral, navy or a darkened photo.
Color rules: coral is a surface colour and the brand; never use it for body text or primary buttons. Primary buttons are navy. Tiles alternate coral / navy / mint so no two neighbours match.

## Typography

- Display: `"Onest", system-ui, sans-serif`, weight 800 for h1/h2 and 700 for card titles, tracking -0.022em, sentence case always.
- Body: `"Onest", system-ui, sans-serif`, 16px / 1.4; lead paragraphs 20px / 1.4 in 60% navy.
- Scale: 12.8 / 16 / 20 / 25 / 31 / 39 / 56 / 64 (stat numerals), footer wordmark ~25vw.
- Labels: 600 weight, no uppercase, no tracking; buttons 600 16px.
- Load: `<link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700;800&display=swap">`
- Rules: headlines 3-7 words, often split on two lines by `<br>`; never italic; uppercase only on tiny badge labels.

## Layout

- Container 1312px content plus 64px side padding; hero and footer bleed to 24px from the viewport edge.
- Base unit 8px; scale 4 / 8 / 16 / 24 / 32 / 48 / 64 / 128.
- Section rhythm 128px; headers left-aligned for carousels, centred for everything else.
- Grids: 4-up carousel rail of 320px square media cards that runs off the right edge; 3-up account cards; bento with 340px tiles either side of a centred statement; 1:1 split for the steps and ranking chart.
- Density: airy. One idea per section, a primary pill under every header.
- Every section header is h2 + 20px muted lead + navy pill "Open a free account".

## Elevation & Depth

Flat, tonal and rounded: depth comes from panel colour (white → mint → navy), not shadows.

- Sticky header: `background: color-mix(in srgb,var(--bg) 70%,transparent); backdrop-filter: blur(16px); box-shadow: 0 1px 1px 0 color-mix(in srgb,var(--fg) 10%,transparent)`. This is the only UI shadow.
- Active nav segment: white pill on mint with that same 1px shadow.
- Cards have no border and no shadow; mint `#f2f8f3` on white is the whole separation.
- Floating card renders inside tiles get `0 24px 48px -18px color-mix(in srgb,var(--fg) 40%,transparent)`.
- Hero photo: a real generated photograph (candid dinner, warm tungsten light, calm dark left third), set as `background: var(--photo-dark) url(...) 70% 50%/cover` on the hero and reused for the split-slide photo half. Never fake the scene with CSS gradients or SVG.
- Hero photo scrim: `linear-gradient(90deg, photo-dark at 62% 0 30%, transparent 72%)` behind the white headline.
- Chips on coral/navy: white at 30% fill, no border.

## Shapes

- 64px: hero, big mint section panels, navy CTA, ranking chart, footer top corners.
- 32px: account cards, carousel media, bento tiles, testimonial cards.
- 16px: step rows, FAQ rows, floating UI tiles inside media.
- 8px: chips, locale select. 4px: "Published" pill.
- 500px pills: every button; 128px circles: 48px icon buttons with 2px navy ring; 36px arrow circles on cards.
- Split slides: left half rounded on the left only, photo half rounded on the right only, so the pair reads as one 64px capsule.
- Payment cards: 1.586 aspect, 12px corners; portrait 0.63 aspect in the fan.

## Components

- Buttons: primary = navy fill, white 600 text, 48px tall, 0 24px, 500px radius, hover lightens fill to navy-700. Secondary = transparent with 2px navy border. Inverse (on photo/navy) = white fill, navy text, hover mint.
- Icon buttons: 48px circle, 2px navy border, arrow glyph; disabled = 10% navy ring, 30% glyph.
- Nav: locale strip (mint, select + round navy go button) above an 88px sticky bar: coral wordmark, a mint segmented pill (Personal / Business) with the active one white, navy "Sign up" pill on the right.
- Account cards: mint 32px card, tiny card render top-left, 36px ringed arrow top-right, title underlines on hover, fine print pinned to the bottom.
- Bento stat tiles: coral or navy 32px tile, big 64px numeral, a translucent chip label, 1-2 bold white lines.
- Steps: three rows, active row white with coral "Step / 1", inactive rows 30% navy; next to a coral panel with two fanned cards and a darker coral band "Join 4.2 million customers".
- Ranking chart: mint 64px panel, ringed rank numbers, wordmarks, pill progress bars and ringed percentages in a darker coral.
- Footer: navy slab with 64px top corners, four link columns (bold 600 links), a flag pill, then the wordmark in coral at full width.

## Do's and Don'ts

- Do make every primary action a navy pill, including on mint panels.
- Do alternate coral, navy and mint tiles so the page reads like a stack of bank cards.
- Do round big panels to 64px and cards to 32px; nothing square.
- Do put one piece of floating app UI (a Burrow row, a balance, a chat bubble) on flat coral instead of a screenshot.
- Do set headlines in 800 weight, sentence case, tight tracking.
- Do end with the giant coral wordmark on the navy footer.

- Don't use coral for buttons or body text.
- Don't add borders or drop shadows to cards.
- Don't use black; ink is navy `#091723`.
- Don't use uppercase eyebrows or tracked labels.
- Don't use gradients on UI surfaces; gradients live only inside images.
- Don't crowd a section with more than one heading, one lead and one button row.

## Motion

- Duration 200ms (buttons), 300ms (arrow circles, title underline, segment pill), easing `cubic-bezier(.22,0,.12,1)` or `ease`.
- What animates: button fill fades, account-card title underline draws in, card arrow fills 10% navy, FAQ row fills mint, the card fan spreads wider on hover, hero copy rises 24px on load.
- What never animates: layout, colour of tiles, the wordmark.
- Signature move: two portrait cards fanned at ±9deg that spread on hover.

## Tweaks

Five knobs. `--panel-radius` (16–80px) drives hero, mint panels, CTA, chart and footer; `--card-radius` (8–48px) drives cards, media and tiles; `--hero-dim` sets the photo scrim; `--fan-tilt` rotates the card fan; `--nav-glass` is the sticky header's opacity. Schemes: Mint Money, Blue Hour, Night Bus, Sherbet, each setting all fourteen colour literals.

## Reference CSS

```css
:root{
--bg:#ffffff;
--bg-2:#f2f8f3;
--fg:#091723;
--ink:#091723;
--fg-muted:#6b747b;
--accent:#ff4f40;
--accent-fg:#ffffff;
--navy:#112231;
--mint-2:#e3ebe4;
--sun:#ffb000;
--photo-lit:#c9793e;
--photo-dark:#241510;
--leaf:#4f7b33;
--sky:#5a86b8;
--border:color-mix(in srgb,var(--fg) 10%,transparent);
--f60:color-mix(in srgb,var(--fg) 60%,transparent);
--f30:color-mix(in srgb,var(--fg) 30%,transparent);
--w30:color-mix(in srgb,var(--accent-fg) 30%,transparent);
--w90:color-mix(in srgb,var(--accent-fg) 90%,transparent);
--hover:color-mix(in srgb,var(--fg) 82%,var(--bg));
--rank:color-mix(in srgb,var(--accent) 72%,var(--fg));
--font-display:"Onest", system-ui, sans-serif;
--font-body:"Onest", system-ui, sans-serif;
--radius:32px;
--radius-sm:8px;
--radius-md:16px;
--radius-lg:64px;
--radius-pill:500px;
--space-1:4px;
--space-2:8px;
--space-3:16px;
--space-4:24px;
--space-5:32px;
--space-6:48px;
--space-7:64px;
--space-8:128px;
--shadow:0 1px 1px 0 color-mix(in srgb,var(--fg) 10%,transparent);
--shadow-card:0 24px 48px -18px color-mix(in srgb,var(--fg) 40%,transparent);
--ease:cubic-bezier(.22,0,.12,1);
--dur:200ms;
--max-width:1312px;
--section:128px;
--hero-dim:62%;
--fan-tilt:9deg;
--card-radius:32px;
--panel-radius:64px;
--nav-glass:70%;
}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:48px;padding:0 24px;border:1px solid var(--fg);border-radius:var(--radius-pill);background:var(--fg);color:var(--accent-fg);font:600 16px/1 var(--font-body)}
.btn:hover{background:var(--hover);border-color:var(--hover)}
.btn.o{background:transparent;color:var(--fg);border:2px solid var(--fg)}
.ac{display:flex;flex-direction:column;padding:40px 26px 26px;min-height:320px;border-radius:var(--card-radius);background:var(--bg-2)}
.ac h3{text-decoration:underline 2px transparent;text-underline-offset:4px;transition:text-decoration-color .3s var(--ease)}
.ac:hover h3{text-decoration-color:currentColor}
.bt{display:flex;flex-direction:column;justify-content:flex-end;height:320px;padding:24px;border-radius:var(--card-radius);background:var(--accent);color:var(--accent-fg)}
```

## Reference markup

```html
<section class="sec">
  <div class="wrap">
    <div class="bento">
      <div class="bt">
        <b class="v">4.2m</b>
        <span class="chip">Customers</span>
        <p>People who moved their pay in and didn't look back.</p>
      </div>
      <div class="bmid">
        <div class="mk">m</div>
        <h2>A regulated bank<br />that answers at 3am</h2>
        <p class="sub">Chat support around the clock.</p>
        <a class="btn" href="#">Open a free Monzoo account</a>
      </div>
      <div class="bt n">
        <b class="v">£0</b>
        <span class="chip">No hidden fees</span>
        <p>No monthly fee and no charge for spending abroad.</p>
      </div>
    </div>
  </div>
</section>
```

## How to apply this flavor

1. Replace the target page's design tokens with the palette, fonts and spacing above.
2. Restyle components to match the Components section; keep the page's content and structure.
3. Apply the motion rules; remove any animation not described here.
4. Check the Don't list before finishing.
