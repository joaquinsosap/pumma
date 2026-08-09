/**
 * The PUMMA mark — the same artwork as the favicon and the installed app
 * icon, so the sidebar, the mobile header and the tour all show the thing a
 * user already has pinned to their taskbar rather than a letter standing in
 * for it.
 *
 * Inline rather than an <img> to app/icon.svg: that route is content-hashed
 * for the favicon and is not a stable URL to point at, and inlining costs no
 * request. The whole thing is one symmetric half mirrored about the centre
 * line, which is how the original was drawn.
 *
 * The gradient and the reused half carry ids, so rendering this twice in one
 * document duplicates them. Every definition is identical and duplicate ids
 * resolve to the first, so the result is the same — the same trade the drawn
 * glyphs make.
 */
export function PummaMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 500 500"
      className={className}
      role="img"
      aria-label="PUMMA"
    >
      <defs>
        <linearGradient id="pummaBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#191F2C" />
          <stop offset="100%" stopColor="#0F131C" />
        </linearGradient>
        <g
          id="pummaHalf"
          stroke="#080C1F"
          strokeWidth="4"
          strokeLinejoin="round"
        >
          <polygon points="320,130 390,120 380,210 350,180" fill="#2E3CBA" />
          <polygon
            points="340,140 370,140 365,190 345,170"
            fill="#141938"
            strokeWidth="2"
          />
          <polygon
            points="250,110 320,130 350,180 280,180 250,220"
            fill="#2B3BBD"
          />
          <polygon points="350,180 380,210 400,260 340,240" fill="#1E6DEB" />
          <polygon
            points="400,260 390,320 350,360 310,310 340,240"
            fill="#03A9F4"
          />
          <polygon
            points="250,220 280,180 340,240 310,310 280,290 250,300"
            fill="#0D1538"
          />
          <polygon points="280,230 330,235 315,265 280,270" fill="#00E5FF" />
          <polygon points="280,290 310,310 315,285 285,285" fill="#0097A7" />
          <polygon
            points="285,270 320,260 315,280 285,280"
            fill="#00FFFF"
            stroke="#00FFFF"
            strokeWidth="1"
          />
          <circle cx="300" cy="272" r="4" fill="#080C1F" stroke="none" />
          <polygon points="250,220 280,290 280,310 250,330" fill="#00BCD4" />
          <polygon
            points="280,310 310,310 350,360 300,370 280,340"
            fill="#00B3FF"
          />
          <polygon points="250,330 280,340 280,360 250,370" fill="#00FFFF" />
          <polygon points="250,370 280,360 270,380 250,380" fill="#080C1F" />
          <polygon
            points="270,380 300,370 350,360 340,380 290,400 250,400"
            fill="#84FFFF"
          />
          <polygon
            points="250,400 290,400 340,380 350,390 290,410 250,410"
            fill="#080C1F"
          />
          <polygon points="250,410 290,410 310,440 250,460" fill="#00E5FF" />
          <path
            d="M 300,375 L 340,368 M 295,385 L 345,380 M 290,395 L 335,395"
            stroke="#080C1F"
            strokeWidth="4"
            strokeLinecap="round"
            fill="none"
          />
        </g>
      </defs>

      <rect width="100%" height="100%" rx="60" fill="url(#pummaBg)" />
      <use href="#pummaHalf" transform="scale(-1, 1) translate(-500, 0)" />
      <use href="#pummaHalf" />
      <line
        x1="250"
        y1="110"
        x2="250"
        y2="460"
        stroke="#080C1F"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}
