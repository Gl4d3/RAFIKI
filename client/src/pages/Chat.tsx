import { AppLayout } from "@/components/AppLayout";

export const Chat = (): JSX.Element => {
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
            <path
              d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"
              stroke="#00342b"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <p style={{ fontSize: 16, fontWeight: 500, color: "#1a1c1c", marginBottom: 8 }}>
          Conversation
        </p>
        <p style={{ fontSize: 13, color: "#3f4945", textAlign: "center" }}>
          Coming in the next update.
        </p>
      </div>
    </AppLayout>
  );
};
