// Small hand-drawn icons, all 24x24, stroke only so they follow the text colour.
const PATHS = {
  list: "M5 6h14M5 12h14M5 18h9",
  plus: "M12 5v14M5 12h14",
  alert: "M12 4 3 20h18L12 4Zm0 6v5m0 3v.01",
  sync: "M20 11a8 8 0 0 0-14.5-4M4 5v4h4M4 13a8 8 0 0 0 14.5 4M20 19v-4h-4",
  check: "m5 12.5 4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6 6 18",
  minus: "M6 12h12",
  back: "M15 5 8 12l7 7",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4",
  search: "M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm5 11 4 4",
  wifioff: "M3 3l18 18M8.5 8.8A10 10 0 0 0 3 12m18 0a10 10 0 0 0-5-2.7M7 15.5a7 7 0 0 1 4-1.9m4.6 1.2A7 7 0 0 1 17 15.5M12 19v.01",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z",
  out: "M10 5H5v14h5M15 8l4 4-4 4M19 12H9",
  pin: "M12 21s6-5.6 6-10.5A6 6 0 0 0 6 10.5C6 15.4 12 21 12 21Zm0-8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
};

export default function Icon({ name, size = 20, className = "" }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
