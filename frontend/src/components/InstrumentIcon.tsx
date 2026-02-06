interface InstrumentIconProps {
  type: string
  size?: number
  className?: string
}

export function InstrumentIcon({ type, size = 16, className = '' }: InstrumentIconProps) {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
  }

  switch (type.toLowerCase()) {
    case 'kick':
      // Boot/sneaker stomping down
      return (
        <svg {...props}>
          <path d="M4 3v5c0 1 1 2 3 2h2c2 0 3-1 3-3V5" />
          <path d="M3 13h4l1-3" />
          <line x1="7" y1="13" x2="7" y2="10" />
        </svg>
      )
    case 'snare':
      // Drum with crossed sticks
      return (
        <svg {...props}>
          <ellipse cx="8" cy="10" rx="5" ry="2" />
          <line x1="3" y1="10" x2="3" y2="7" />
          <line x1="13" y1="10" x2="13" y2="7" />
          <ellipse cx="8" cy="7" rx="5" ry="2" />
          <line x1="2" y1="2" x2="10" y2="6" />
          <line x1="14" y1="2" x2="6" y2="6" />
        </svg>
      )
    case 'hihat':
      // Two stacked ovals (cymbals)
      return (
        <svg {...props}>
          <ellipse cx="8" cy="6" rx="6" ry="2" />
          <ellipse cx="8" cy="9" rx="6" ry="2" />
          <line x1="8" y1="4" x2="8" y2="2" />
          <line x1="8" y1="11" x2="8" y2="14" />
        </svg>
      )
    case 'clap':
      // Two hands meeting
      return (
        <svg {...props}>
          <path d="M4 4l3 4-3 4" />
          <path d="M12 4l-3 4 3 4" />
          <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'shaker':
      // Egg maraca with dots
      return (
        <svg {...props}>
          <ellipse cx="8" cy="7" rx="4" ry="5" />
          <line x1="8" y1="12" x2="8" y2="15" />
          <circle cx="7" cy="6" r="0.7" fill="currentColor" stroke="none" />
          <circle cx="9" cy="5" r="0.7" fill="currentColor" stroke="none" />
          <circle cx="8" cy="8" r="0.7" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'cymbal':
      // Single tilted oval with motion lines
      return (
        <svg {...props}>
          <ellipse cx="8" cy="8" rx="6" ry="2" transform="rotate(-15 8 8)" />
          <line x1="12" y1="4" x2="14" y2="3" />
          <line x1="13" y1="6" x2="15" y2="5" />
        </svg>
      )
    case 'tom':
      // Side-view drum
      return (
        <svg {...props}>
          <ellipse cx="8" cy="4" rx="5" ry="2" />
          <line x1="3" y1="4" x2="3" y2="11" />
          <line x1="13" y1="4" x2="13" y2="11" />
          <ellipse cx="8" cy="11" rx="5" ry="2" />
        </svg>
      )
    case 'bass':
      // Thick sine wave
      return (
        <svg {...props}>
          <path d="M2 8c2-4 4-4 6 0s4 4 6 0" strokeWidth="2.5" />
        </svg>
      )
    case 'pad':
      // Puffy cloud
      return (
        <svg {...props}>
          <path d="M4 11c-2 0-3-1-3-2.5S2 6 4 6c0-2 2-3 4-3s4 1 4 3c2 0 3 1.5 3 2.5S14 11 12 11z" />
        </svg>
      )
    case 'lead':
      // Lightning bolt
      return (
        <svg {...props}>
          <path d="M9 1L4 9h4l-1 6 5-8H8l1-6z" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'vocal':
      // Microphone
      return (
        <svg {...props}>
          <rect x="6" y="2" width="4" height="6" rx="2" />
          <path d="M4 7v1c0 2.2 1.8 4 4 4s4-1.8 4-4V7" />
          <line x1="8" y1="12" x2="8" y2="14" />
          <line x1="6" y1="14" x2="10" y2="14" />
        </svg>
      )
    case 'fx':
      // 4-pointed sparkle
      return (
        <svg {...props}>
          <path d="M8 2l1.5 4.5L14 8l-4.5 1.5L8 14l-1.5-4.5L2 8l4.5-1.5z" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'percussion':
      // Drumstick at angle
      return (
        <svg {...props}>
          <line x1="3" y1="13" x2="12" y2="4" strokeWidth="2" />
          <circle cx="12.5" cy="3.5" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'keys':
      // Piano keys (2 white, 1 black)
      return (
        <svg {...props}>
          <rect x="2" y="3" width="5" height="10" rx="0.5" />
          <rect x="9" y="3" width="5" height="10" rx="0.5" />
          <rect x="6" y="3" width="4" height="6" rx="0.5" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'guitar':
      // Guitar body silhouette
      return (
        <svg {...props}>
          <path d="M8 2v4" />
          <path d="M6 6h4" />
          <path d="M6 6c-3 2-3 6 0 7h4c3-1 3-5 0-7" />
          <circle cx="8" cy="10" r="1.5" />
        </svg>
      )
    case 'strings':
      // Bow arc
      return (
        <svg {...props}>
          <path d="M3 13C3 6 13 6 13 13" fill="none" />
          <line x1="3" y1="2" x2="3" y2="13" />
        </svg>
      )
    default:
      // Music note
      return (
        <svg {...props}>
          <circle cx="6" cy="11" r="2.5" fill="currentColor" stroke="none" />
          <line x1="8.5" y1="11" x2="8.5" y2="3" strokeWidth="1.5" />
          <path d="M8.5 3c2 0 4 1 4 2.5" />
        </svg>
      )
  }
}
