// TMDB poster at the right size for its slot. Plain <img> with srcset on
// purpose: the app is self-hosted on a Jetson, and the Next image optimizer
// would spend Nano CPU re-encoding posters TMDB already serves resized.
// Lazy, async-decoded, with intrinsic size so cards never shift as it lands.

const TMDB = "https://image.tmdb.org/t/p";

// TMDB's poster widths: pick the smallest that covers the slot at 1x and 2x
function sizes(width: number): [string, string] {
  if (width <= 46) return ["w92", "w92"];
  if (width <= 92) return ["w92", "w185"];
  if (width <= 154) return ["w154", "w342"];
  if (width <= 185) return ["w185", "w342"];
  return ["w342", "w500"];
}

export function Poster({
  path,
  alt,
  width,
  height,
  className = "",
  eager = false,
}: {
  path: string | null | undefined;
  alt: string;
  width: number;
  height: number;
  className?: string;
  eager?: boolean;
}) {
  if (!path)
    return (
      <div
        className={`flex items-center justify-center bg-surface-0 text-center text-xs text-muted ${className}`}
        style={{ width, height }}
        aria-hidden={alt === ""}
      >
        no poster
      </div>
    );
  const [one, two] = sizes(width);
  return (
    <img
      src={`${TMDB}/${one}${path}`}
      srcSet={`${TMDB}/${one}${path} 1x, ${TMDB}/${two}${path} 2x`}
      alt={alt}
      width={width}
      height={height}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      className={`object-cover ${className}`}
    />
  );
}
