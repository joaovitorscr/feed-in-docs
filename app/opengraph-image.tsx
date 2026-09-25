import { ImageResponse } from "next/og";

export const alt = "Feed in Docs — paste a documentation URL, get an llms.txt index";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 28,
        backgroundColor: "#0a0a0a",
        backgroundImage: "radial-gradient(circle, #262626 1px, transparent 1.5px)",
        backgroundSize: "24px 24px",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width="112" height="112" viewBox="0 0 64 64">
          <rect width="64" height="64" rx="14" fill="#fafafa" />
          <g
            transform="translate(20 20)"
            fill="none"
            stroke="#171717"
            stroke-width="2.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
            <path d="M14 2v4a2 2 0 0 0 2 2h4" />
            <path d="M10 9H8" />
            <path d="M16 13H8" />
            <path d="M16 17H8" />
          </g>
        </svg>
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 76,
          fontWeight: 700,
          color: "#fafafa",
          letterSpacing: "-0.03em",
        }}
      >
        Docs in. llms.txt out.
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 30,
          color: "#a3a3a3",
        }}
      >
        Paste a documentation URL, get a copyable index for your agent
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          borderRadius: 999,
          border: "1px solid #262626",
          padding: "12px 28px",
          fontSize: 26,
          color: "#d4d4d4",
        }}
      >
        feed-in-docs.vercel.app
      </div>
    </div>,
    { ...size },
  );
}
