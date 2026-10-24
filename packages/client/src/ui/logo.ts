/**
 * Title-screen wordmarks as inline SVG strings (viewBox 0 0 520 200), designed for a dark navy
 * background (#14142b). Chunky rounded lettering + a peeking chameleon with sonar rings.
 * No external fonts: uses a rounded font stack with system fallbacks.
 */

type Letter = { ch: string; x: number; rot: number; top: string; bottom: string };

const INK = '#1a1a2e';
const SKIN_DARK = '#1f9e48';
const FONT = "'Baloo 2','Fredoka','Arial Rounded MT Bold','Nunito',system-ui,sans-serif";

function letterText(l: Letter, fill: string): string {
  return `<text x="${l.x}" y="150" transform="rotate(${l.rot} ${l.x} 108)" fill="${fill}">${l.ch}</text>`;
}

function buildLogo(id: string, label: string, letters: readonly Letter[]): string {
  const gradients = letters
    .map(
      (l, i) =>
        `<linearGradient id="${id}-l${i}" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0.15" stop-color="${l.top}"/><stop offset="0.85" stop-color="${l.bottom}"/></linearGradient>`,
    )
    .join('');
  const shadow = letters.map((l) => letterText(l, '#0a0a1f')).join('');
  const main = letters.map((l, i) => letterText(l, `url(#${id}-l${i})`)).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 200" role="img" aria-label="${label}">
<defs>
${gradients}
<linearGradient id="${id}-skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a6ff74"/><stop offset="1" stop-color="#2fc25a"/></linearGradient>
<radialGradient id="${id}-eye" cx="0.38" cy="0.35" r="0.75"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d7e0ff"/></radialGradient>
</defs>
<g fill="none" stroke="#3ee6c1" stroke-linecap="round">
<circle cx="430" cy="98" r="44" stroke-width="6" opacity="0.6"/>
<circle cx="430" cy="98" r="68" stroke-width="5" opacity="0.36"/>
<circle cx="430" cy="98" r="92" stroke-width="4" opacity="0.18"/>
</g>
<g font-family="${FONT}" font-weight="800" font-size="128" text-anchor="middle" stroke-linejoin="round" paint-order="stroke">
<g stroke="#0a0a1f" stroke-width="16" transform="translate(2 9)">${shadow}</g>
</g>
<g stroke="${INK}" stroke-linecap="round" stroke-linejoin="round">
<path d="M500 158 C510 176 498 192 480 188 C464 184 466 166 479 166 C489 166 490 177 482 178" fill="none" stroke-width="17"/>
<path d="M500 158 C510 176 498 192 480 188 C464 184 466 166 479 166 C489 166 490 177 482 178" fill="none" stroke="url(#${id}-skin)" stroke-width="9"/>
<path d="M452 150 C430 156 402 142 382 126" fill="none" stroke-width="16"/>
<path d="M452 150 C430 156 402 142 382 126" fill="none" stroke="#5fe068" stroke-width="8"/>
<path d="M455 112 C480 94 510 102 511 136 C512 162 486 178 458 170 C440 163 438 128 455 112 Z" fill="url(#${id}-skin)" stroke-width="6"/>
<path d="M479 104 C470 125 473 150 485 171 M498 112 C492 130 494 150 503 162" fill="none" stroke="${SKIN_DARK}" stroke-width="5" opacity="0.55"/>
</g>
<g font-family="${FONT}" font-weight="800" font-size="128" text-anchor="middle" stroke-linejoin="round" paint-order="stroke">
<g stroke="${INK}" stroke-width="14">${main}</g>
</g>
<g stroke="${INK}" stroke-linecap="round" stroke-linejoin="round">
<ellipse cx="373" cy="115" rx="7.5" ry="5.5" transform="rotate(-25 373 115)" fill="#5fe068" stroke-width="4.5"/>
<ellipse cx="374" cy="129" rx="7.5" ry="5.5" transform="rotate(20 374 129)" fill="#5fe068" stroke-width="4.5"/>
<path d="M472 128 C474 100 466 72 452 54 C428 60 404 80 392 104 C386 115 392 126 405 128 C426 134 452 137 472 128 Z" fill="url(#${id}-skin)" stroke-width="6"/>
<path d="M452 60 C445 78 446 98 452 114 M463 80 C456 94 457 112 465 126" fill="none" stroke="${SKIN_DARK}" stroke-width="4" opacity="0.5"/>
<ellipse cx="452" cy="124" rx="8" ry="4.5" fill="#ff7fb0" stroke="none" opacity="0.8"/>
<path d="M398 117 Q418 126 440 121 Q446 119 447 113" fill="none" stroke-width="4.5"/>
<circle cx="398" cy="106" r="2.2" fill="${INK}" stroke="none"/>
<circle cx="430" cy="96" r="24" fill="url(#${id}-skin)" stroke-width="6"/>
<circle cx="430" cy="96" r="18.5" fill="none" stroke="${SKIN_DARK}" stroke-width="3" opacity="0.6"/>
<circle cx="428" cy="97" r="13.5" fill="url(#${id}-eye)" stroke-width="4"/>
<circle cx="421" cy="99" r="7" fill="${INK}" stroke="none"/>
<circle cx="418" cy="95" r="2.6" fill="#ffffff" stroke="none"/>
</g>
</svg>`;
}

export const LOGO_SVG: string = buildLogo('psst', 'PSST!', [
  { ch: 'P', x: 60, rot: -8, top: '#fff27a', bottom: '#ffc21a' },
  { ch: 'S', x: 138, rot: 6, top: '#ffa3cf', bottom: '#ff4f9a' },
  { ch: 'S', x: 212, rot: -5, top: '#97f8e3', bottom: '#1fcfa5' },
  { ch: 'T', x: 288, rot: 7, top: '#ffc684', bottom: '#ff7a1f' },
  { ch: '!', x: 350, rot: -6, top: '#dcb4ff', bottom: '#9b5cff' },
]);

export const LOGO_SVG_PT: string = buildLogo('psiu', 'PSIU!', [
  { ch: 'P', x: 64, rot: -8, top: '#fff27a', bottom: '#ffc21a' },
  { ch: 'S', x: 143, rot: 6, top: '#ffa3cf', bottom: '#ff4f9a' },
  { ch: 'I', x: 207, rot: -5, top: '#97f8e3', bottom: '#1fcfa5' },
  { ch: 'U', x: 275, rot: 7, top: '#ffc684', bottom: '#ff7a1f' },
  { ch: '!', x: 350, rot: -6, top: '#dcb4ff', bottom: '#9b5cff' },
]);
