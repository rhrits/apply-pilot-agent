import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "UplyFox — AI job application assistant";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          padding: "68px 76px",
          color: "#202040",
          background: "#f8f7ff",
          fontFamily: "Arial",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 58,
              height: 58,
              borderRadius: 16,
              color: "white",
              fontSize: 28,
              fontWeight: 700,
              background: "#312e81",
            }}
          >
            U
          </div>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 700 }}>UplyFox</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 930 }}>
          <div style={{ display: "flex", color: "#8b1e3f", fontSize: 22, fontWeight: 700, letterSpacing: 2 }}>
            AI JOB APPLICATION ASSISTANT
          </div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 68, lineHeight: 1.05, fontWeight: 800, letterSpacing: -3 }}>
            <span>Outfox the hiring grind.</span>
            <span style={{ color: "#312e81" }}>Stay in control.</span>
          </div>
          <div style={{ display: "flex", color: "#6f6d86", fontSize: 25, lineHeight: 1.35 }}>
            Build one verified profile and get grounded help with repetitive application forms.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: "#77768b", fontSize: 20 }}>
          <span>Grounded answers · Review first · Never auto-submits</span>
          <span>Built by Hritik</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
