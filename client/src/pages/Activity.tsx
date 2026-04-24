import { useState, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/AppLayout";
import { useRafiki } from "@/lib/rafiki-context";
import type { ActivityEvent } from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────

type FilterKind = "all" | "transfer" | "savings" | "goal" | "alert";

const FILTER_CHIPS: { label: string; value: FilterKind }[] = [
  { label: "All", value: "all" },
  { label: "Sends", value: "transfer" },
  { label: "Savings", value: "savings" },
  { label: "Goals", value: "goal" },
  { label: "Alerts", value: "alert" },
];

// ── Date bucketing ────────────────────────────────────────────────────────────

function dateBucket(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const weekAgo = new Date(today.getTime() - 6 * 86_400_000);
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (d.getTime() === today.getTime()) return "Today";
  if (d.getTime() === yesterday.getTime()) return "Yesterday";
  if (d >= weekAgo) return "Earlier this week";
  return d.toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" });
}

function groupByDate(events: ActivityEvent[]): { bucket: string; events: ActivityEvent[] }[] {
  const map = new Map<string, ActivityEvent[]>();
  for (const ev of events) {
    const b = dateBucket(new Date(ev.createdAt!));
    if (!map.has(b)) map.set(b, []);
    map.get(b)!.push(ev);
  }
  return Array.from(map.entries()).map(([bucket, evs]) => ({ bucket, events: evs }));
}

// ── Kind helpers ──────────────────────────────────────────────────────────────

type KindStyle = { dot: string; amountColor: string; isOutflow: boolean };

const KIND_STYLES: Record<string, KindStyle> = {
  transfer: { dot: "#00342b", amountColor: "#3f4945", isOutflow: true },
  savings:  { dot: "#4755b6", amountColor: "#3f4945", isOutflow: true },
  goal:     { dot: "#FFA000", amountColor: "#b36200", isOutflow: false },
  salary:   { dot: "#00342b", amountColor: "#00342b", isOutflow: false },
  system:   { dot: "#bfc9c4", amountColor: "#3f4945", isOutflow: false },
  alert:    { dot: "#FFA000", amountColor: "#b36200", isOutflow: false },
};

function kindStyle(kind: string): KindStyle {
  return KIND_STYLES[kind] ?? KIND_STYLES.system;
}

function fmtAmount(ev: ActivityEvent): string | null {
  if (ev.amount == null) return null;
  const abs = Math.abs(ev.amount);
  const label = `KSh ${Math.round(abs).toLocaleString("en-KE")}`;
  const ks = kindStyle(ev.kind);
  return ks.isOutflow ? `−${label}` : label;
}

function fmtTime(date: Date): string {
  return date.toLocaleTimeString("en-KE", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// ── Filter chips logic ────────────────────────────────────────────────────────

function matchesFilter(ev: ActivityEvent, filter: FilterKind): boolean {
  if (filter === "all") return true;
  if (filter === "alert") return ev.kind === "alert" || ev.kind === "system";
  return ev.kind === filter;
}

// ── Event Row ─────────────────────────────────────────────────────────────────

function EventRow({ ev }: { ev: ActivityEvent }) {
  const ks = kindStyle(ev.kind);
  const amount = fmtAmount(ev);
  const time = fmtTime(new Date(ev.createdAt!));

  return (
    <div
      data-testid={`row-activity-${ev.id}`}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 14,
        paddingTop: 14,
        paddingBottom: 14,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          background: `${ks.dot}18`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          marginTop: 1,
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: ks.dot,
            display: "block",
          }}
        />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            fontSize: 14,
            fontWeight: 400,
            color: "#1a1c1c",
            margin: 0,
            lineHeight: 1.4,
          }}
          data-testid={`text-activity-desc-${ev.id}`}
        >
          {ev.description}
        </p>
        <p
          style={{
            fontSize: 10,
            fontWeight: 500,
            color: "#3f4945",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            margin: "4px 0 0",
          }}
          data-testid={`text-activity-time-${ev.id}`}
        >
          {time}
        </p>
      </div>

      {amount && (
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <p
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: ks.amountColor,
              margin: 0,
              whiteSpace: "nowrap",
            }}
            data-testid={`text-activity-amount-${ev.id}`}
          >
            {amount}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function ActivitySkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            paddingTop: 14,
            paddingBottom: 14,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "#f3f3f3",
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1 }}>
            <div style={{ height: 14, width: "70%", borderRadius: 6, background: "#f3f3f3", marginBottom: 6 }} />
            <div style={{ height: 10, width: "30%", borderRadius: 6, background: "#e8e8e8" }} />
          </div>
          <div style={{ height: 14, width: 64, borderRadius: 6, background: "#f3f3f3" }} />
        </div>
      ))}
    </div>
  );
}

// ── Activity Page ─────────────────────────────────────────────────────────────

export function Activity() {
  const { user } = useRafiki();
  const userId = user?.userId ?? "";
  const [activeFilter, setActiveFilter] = useState<FilterKind>("all");
  const chipScrollRef = useRef<HTMLDivElement>(null);

  const { data: events, isLoading } = useQuery<ActivityEvent[]>({
    queryKey: ["/api/user", userId, "activity"],
    queryFn: () => fetch(`/api/user/${userId}/activity`).then((r) => r.json()),
    enabled: !!userId,
  });

  const filtered = useMemo(() => {
    if (!events) return [];
    return events.filter((ev) => matchesFilter(ev, activeFilter));
  }, [events, activeFilter]);

  const grouped = useMemo(() => groupByDate(filtered), [filtered]);

  return (
    <AppLayout>
      <div
        style={{
          maxWidth: 480,
          margin: "0 auto",
          padding: "24px 0 32px",
          fontFamily: "'Inter', sans-serif",
        }}
      >
        <h1
          style={{
            fontSize: 22,
            fontWeight: 500,
            color: "#1a1c1c",
            marginBottom: 20,
            letterSpacing: "-0.01em",
            paddingLeft: 20,
            paddingRight: 20,
          }}
          data-testid="text-activity-heading"
        >
          Activity
        </h1>

        {/* Filter chips with right-edge fade */}
        <div style={{ position: "relative", marginBottom: 24 }}>
          <div
            ref={chipScrollRef}
            style={{
              display: "flex",
              gap: 8,
              overflowX: "auto",
              paddingLeft: 20,
              paddingRight: 48,
              paddingBottom: 4,
              scrollbarWidth: "none",
            }}
          >
            {FILTER_CHIPS.map((chip) => {
              const active = activeFilter === chip.value;
              return (
                <button
                  key={chip.value}
                  data-testid={`chip-filter-${chip.value}`}
                  onClick={() => setActiveFilter(chip.value)}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 9999,
                    border: "none",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    background: active ? "#4755b6" : "#f3f3f3",
                    color: active ? "#ffffff" : "#3f4945",
                    fontFamily: "'Inter', sans-serif",
                    transition: "background 0.15s, color 0.15s",
                    flexShrink: 0,
                  }}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
          {/* Right fade gradient */}
          <div
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 4,
              width: 48,
              pointerEvents: "none",
              background: "linear-gradient(to right, transparent, #f9f9f9 80%)",
            }}
          />
        </div>

        {/* Content */}
        <div style={{ paddingLeft: 20, paddingRight: 20 }}>
          {isLoading && <ActivitySkeleton />}

          {!isLoading && filtered.length === 0 && (
            <p
              style={{ fontSize: 14, color: "#3f4945", paddingTop: 40, textAlign: "center" }}
              data-testid="text-activity-empty"
            >
              Nothing here yet.
            </p>
          )}

          {!isLoading && grouped.map(({ bucket, events: bucketEvents }) => (
            <div key={bucket}>
              <p
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  color: "#3f4945",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  margin: "24px 0 0",
                }}
                data-testid={`text-date-bucket-${bucket.replace(/\s+/g, "-").toLowerCase()}`}
              >
                {bucket}
              </p>

              {/* Zero-divider: separation via vertical white space only */}
              <div>
                {bucketEvents.map((ev, i) => (
                  <div key={ev.id}>
                    <EventRow ev={ev} />
                    {i < bucketEvents.length - 1 && (
                      <div style={{ height: 1, background: "transparent" }} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
