// Tiny inline icon set (stroke icons, currentColor). Decorative by default:
// every use sits next to a text label or inside an aria-labelled button.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, ...rest }: P) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...rest,
  };
}

export const ChatIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H9l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5z" />
  </svg>
);
export const GraphIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="6" cy="17" r="2.5" />
    <circle cx="18" cy="17" r="2.5" />
    <circle cx="12" cy="6" r="2.5" />
    <path d="M8 15.5 10.5 8M16 15.5 13.5 8M8.5 17h7" />
  </svg>
);
export const ListIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 6h12M8 12h12M8 18h12" />
    <circle cx="4" cy="6" r="1" fill="currentColor" />
    <circle cx="4" cy="12" r="1" fill="currentColor" />
    <circle cx="4" cy="18" r="1" fill="currentColor" />
  </svg>
);
export const StarIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1.1 5.8L12 16.8l-5.3 2.8 1.1-5.8-4.3-4.1 5.9-.8z" />
  </svg>
);
export const DotsIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);
export const CloseIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const ChevronLeftIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m14.5 5-7 7 7 7" />
  </svg>
);
export const ChevronUpIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m5 14.5 7-7 7 7" />
  </svg>
);
export const ChevronDownIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m5 9.5 7 7 7-7" />
  </svg>
);
export const InfoIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5" />
    <circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);
export const PlusIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
