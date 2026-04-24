import { useLocation, Link } from "wouter";

interface AppLayoutProps {
  children: React.ReactNode;
}

const NAV_ITEMS = [
  {
    href: "/home",
    label: "Home",
    testId: "nav-home",
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path
          d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"
          stroke={active ? "#00342b" : "#3f4945"}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={active ? "rgba(0,52,43,0.12)" : "none"}
        />
        <polyline
          points="9,22 9,12 15,12 15,22"
          stroke={active ? "#00342b" : "#3f4945"}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    href: "/chat",
    label: "Chat",
    testId: "nav-chat",
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path
          d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"
          stroke={active ? "#00342b" : "#3f4945"}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={active ? "rgba(0,52,43,0.12)" : "none"}
        />
      </svg>
    ),
  },
  {
    href: "/goals",
    label: "Goals",
    testId: "nav-goals",
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke={active ? "#00342b" : "#3f4945"}
          strokeWidth="1.5"
          fill={active ? "rgba(0,52,43,0.12)" : "none"}
        />
        <circle
          cx="12"
          cy="12"
          r="6"
          stroke={active ? "#00342b" : "#3f4945"}
          strokeWidth="1.5"
        />
        <circle
          cx="12"
          cy="12"
          r="2"
          fill={active ? "#00342b" : "#3f4945"}
        />
      </svg>
    ),
  },
  {
    href: "/activity",
    label: "Activity",
    testId: "nav-activity",
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <polyline
          points="22,12 18,12 15,21 9,3 6,12 2,12"
          stroke={active ? "#00342b" : "#3f4945"}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

export function AppLayout({ children }: AppLayoutProps) {
  const [location] = useLocation();

  return (
    <div className="flex flex-col min-h-screen" style={{ fontFamily: "'Inter', sans-serif", background: "#f9f9f9" }}>
      <main className="flex-1 pb-[72px]">
        {children}
      </main>

      <nav
        data-testid="bottom-nav"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          height: 72,
          background: "rgba(249,249,249,0.8)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderTop: "none",
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-around",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        {NAV_ITEMS.map((item) => {
          const active =
            item.href === "/home"
              ? location === "/" || location === "/home"
              : location.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              data-testid={item.testId}
              style={{ textDecoration: "none" }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                  padding: "8px 16px",
                  position: "relative",
                }}
              >
                {item.icon(active)}
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 500,
                    color: active ? "#00342b" : "#3f4945",
                    letterSpacing: "0.02em",
                  }}
                >
                  {item.label}
                </span>
                {active && (
                  <span
                    style={{
                      position: "absolute",
                      bottom: 0,
                      left: "50%",
                      transform: "translateX(-50%)",
                      width: 4,
                      height: 4,
                      borderRadius: "50%",
                      background: "#00342b",
                    }}
                  />
                )}
              </div>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
