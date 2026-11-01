import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "Feed in Docs — paste a documentation URL, get an llms.txt index";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const fontDir = join(process.cwd(), "node_modules/@fontsource/onest/files");
const onestRegular = await readFile(join(fontDir, "onest-latin-400-normal.woff"));
const onestExtraBold = await readFile(join(fontDir, "onest-latin-800-normal.woff"));

const INK = "#091723";
const MUTED = "#6b747b";
const CORAL = "#ff4f40";
const MINT = "#f2f8f3";
const NAVY = "#112231";
const WHITE = "#ffffff";

function FanCard({ tilt, left, dark, title }: FanCardProps) {
  return (
    <div
      style={{
        position: "absolute",
        top: 102,
        left,
        width: 220,
        height: 349,
        display: "flex",
        alignItems: "flex-end",
        padding: 24,
        borderRadius: 12,
        backgroundColor: dark ? NAVY : WHITE,
        color: dark ? WHITE : INK,
        fontSize: 30,
        fontWeight: 800,
        transform: `rotate(${tilt}deg)`,
      }}
    >
      {title}
    </div>
  );
}

type FanCardProps = { tilt: number; left: number; dark?: boolean; title: string };

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        padding: 24,
        backgroundColor: WHITE,
        fontFamily: "Onest",
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 56,
          borderRadius: "64px 0 0 64px",
          backgroundColor: MINT,
          color: INK,
        }}
      >
        <div style={{ display: "flex", fontSize: 34, fontWeight: 800, color: CORAL }}>
          feed in docs
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 88,
              fontWeight: 800,
              lineHeight: 1.1,
              letterSpacing: "-0.022em",
            }}
          >
            <span>Docs in.</span>
            <span>llms.txt out.</span>
          </div>
          <div style={{ display: "flex", fontSize: 28, color: MUTED }}>
            Paste a URL, get an index for your agent
          </div>
        </div>
      </div>
      <div
        style={{
          position: "relative",
          width: 460,
          display: "flex",
          borderRadius: "0 64px 64px 0",
          backgroundColor: CORAL,
        }}
      >
        <FanCard tilt={-9} left={28} title="docs" />
        <FanCard tilt={9} left={184} dark title="llms.txt" />
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: "Onest", data: onestRegular, style: "normal", weight: 400 },
        { name: "Onest", data: onestExtraBold, style: "normal", weight: 800 },
      ],
    },
  );
}
