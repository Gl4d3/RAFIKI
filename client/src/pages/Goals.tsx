import { AppLayout } from "@/components/AppLayout";

export const Goals = (): JSX.Element => {
  return (
    <AppLayout>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "60vh",
          padding: "0 24px",
          fontFamily: "Inter, sans-serif",
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            background: "rgba(0,52,43,0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 16,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="#00342b" strokeWidth="1.5" />
            <circle cx="12" cy="12" r="6" stroke="#00342b" strokeWidth="1.5" />
            <circle cx="12" cy="12" r="2" fill="#00342b" />
          </svg>
        </div>
        <p style={{ fontSize: 16, fontWeight: 500, color: "#1a1c1c", marginBottom: 8 }}>
          Goals
        </p>
        <p style={{ fontSize: 13, color: "#3f4945", textAlign: "center" }}>
          Coming in the next update.
        </p>
      </div>
    </AppLayout>
  );
};
