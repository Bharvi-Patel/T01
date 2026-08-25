import { useEffect, useState } from "react";
import { getAnalyticsSummary, refreshAnalytics } from "../api";
import { PLATFORMS, PlatformLogo } from "./platforms";

export const RANGE_OPTIONS = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];

function platformByKey(key) {
  return PLATFORMS.find((p) => p.key === key);
}

// Small bar sparkline built from daily {success, failure} counts — same
// shape as the reference dashboard's metric cards, just built from real
// publish-attempt counts instead of pulled-in follower/reach data.
function Sparkline({ daily, metric }) {
  if (!daily.length) {
    return <div style={{ height: 32 }} />;
  }
  const max = Math.max(1, ...daily.map((d) => d[metric]));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 32 }}>
      {daily.map((d) => (
        <div
          key={d.date}
          title={`${d.date}: ${d[metric]}`}
          style={{
            width: 5,
            height: Math.max(2, (d[metric] / max) * 32),
            borderRadius: 2,
            background: metric === "failure" ? "var(--danger)" : "var(--accent)",
            opacity: d[metric] === 0 ? 0.25 : 1,
          }}
        />
      ))}
    </div>
  );
}

function MetricCard({ label, value, delta, daily, metric }) {
  return (
    <div
      style={{
        background: "var(--paper-raised)", border: "0.5px solid var(--border-strong)",
        borderRadius: 8, padding: "14px 16px", flex: "1 1 180px", minWidth: 160,
      }}
    >
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "var(--ink)" }}>{value}</span>
        {delta != null && (
          <span
            style={{
              fontSize: 11, fontWeight: 500, borderRadius: 4, padding: "2px 6px",
              color: delta >= 0 ? "#4CAF7D" : "var(--danger)",
              background: delta >= 0 ? "rgba(76,175,125,0.12)" : "var(--danger-bg)",
            }}
          >
            {delta >= 0 ? "+" : ""}{delta}%
          </span>
        )}
      </div>
      {daily && <Sparkline daily={daily} metric={metric} />}
    </div>
  );
}

function CadenceChart({ cadence }) {
  const max = Math.max(1, ...cadence.map((d) => d.count));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 90, padding: "0 4px" }}>
      {cadence.map((d) => (
        <div key={d.weekday} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{d.count || ""}</span>
          <div
            title={`${d.weekday}: ${d.count}`}
            style={{
              width: "100%", maxWidth: 26, height: Math.max(3, (d.count / max) * 56),
              borderRadius: 3, background: "var(--accent)", opacity: d.count === 0 ? 0.2 : 1,
            }}
          />
          <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{d.weekday}</span>
        </div>
      ))}
    </div>
  );
}

function PlatformReliabilityRow({ platformKey, entries }) {
  const p = platformByKey(platformKey);
  const withRate = entries.map((e) => ({ ...e, rate: e.total ? e.success / e.total : 0 }));
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        {p ? <PlatformLogo platform={p} size={13} /> : null}
        <span style={{ fontSize: 12.5, color: "var(--ink)" }}>{p?.label || platformKey}</span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 30 }}>
        {withRate.map((e) => (
          <div
            key={e.date}
            title={`${e.date}: ${e.success}/${e.total}`}
            style={{
              flex: 1, maxWidth: 10, height: Math.max(2, e.rate * 30), borderRadius: 2,
              background: e.rate === 1 ? "#4CAF7D" : e.rate === 0 ? "var(--danger)" : "#D9A441",
            }}
          />
        ))}
      </div>
    </div>
  );
}

// Follower count card: current total + a tiny growth line from
// FollowerSnapshot rows. Only shows a trend once there are 2+ snapshots
// (i.e. Refresh has been run on at least two different days) — a single
// point can't show direction.
function FollowerCard({ platformKey, count, series }) {
  const p = platformByKey(platformKey);
  const first = series?.[0]?.count;
  const delta = series && series.length > 1 && first != null ? count - first : null;
  const max = Math.max(1, ...(series || []).map((d) => d.count));
  const min = Math.min(...(series || []).map((d) => d.count), count);
  const range = Math.max(1, max - min);
  return (
    <div
      style={{
        background: "var(--paper-raised)", border: "0.5px solid var(--border-strong)",
        borderRadius: 8, padding: "14px 16px", flex: "1 1 180px", minWidth: 160,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>
        {p ? <PlatformLogo platform={p} size={12} /> : null}
        {p?.label || platformKey} followers
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "var(--ink)" }}>{count.toLocaleString()}</span>
        {delta != null && (
          <span
            style={{
              fontSize: 11, fontWeight: 500, borderRadius: 4, padding: "2px 6px",
              color: delta >= 0 ? "#4CAF7D" : "var(--danger)",
              background: delta >= 0 ? "rgba(76,175,125,0.12)" : "var(--danger-bg)",
            }}
          >
            {delta >= 0 ? "+" : ""}{delta}
          </span>
        )}
      </div>
      {series && series.length > 1 ? (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 32 }}>
          {series.map((d) => (
            <div
              key={d.date}
              title={`${d.date}: ${d.count}`}
              style={{
                flex: 1, height: Math.max(2, ((d.count - min) / range) * 32),
                borderRadius: 2, background: "var(--accent)",
              }}
            />
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>Refresh again on a later day to see growth.</p>
      )}
    </div>
  );
}

function TopPostsSection({ posts }) {
  if (!posts || posts.length === 0) return null;
  return (
    <div
      style={{
        marginTop: 12, background: "var(--paper-raised)", border: "0.5px solid var(--border-strong)",
        borderRadius: 8, padding: "14px 16px",
      }}
    >
      <div style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500, marginBottom: 12 }}>Top performing posts</div>
      {posts.map((post, i) => {
        const p = platformByKey(post.platform);
        return (
          <div
            key={i}
            style={{
              display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
              borderTop: i > 0 ? "0.5px solid var(--border)" : "none",
            }}
          >
            {p ? <PlatformLogo platform={p} size={14} /> : null}
            <span style={{ fontSize: 12.5, color: "var(--ink)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {post.title}
            </span>
            <span style={{ fontSize: 12, color: "var(--text-secondary)", flexShrink: 0 }}>
              {post.likes} likes · {post.comments} comments
            </span>
            <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
              {new Date(post.published_at).toLocaleDateString()}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function EngagementByWeekdaySection({ weekday }) {
  const hasData = weekday && weekday.some((d) => d.avg_engagement > 0);
  const max = Math.max(1, ...(weekday || []).map((d) => d.avg_engagement));
  return (
    <div
      style={{
        background: "var(--paper-raised)", border: "0.5px solid var(--border-strong)",
        borderRadius: 8, padding: "14px 16px", flex: "1 1 260px",
      }}
    >
      <div style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500, marginBottom: 4 }}>Engagement by day of week</div>
      <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 0, marginBottom: 12 }}>
        Average likes + comments per post published on that weekday.
      </p>
      {hasData ? (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 90, padding: "0 4px" }}>
          {weekday.map((d) => (
            <div key={d.weekday} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{d.avg_engagement || ""}</span>
              <div
                title={`${d.weekday}: ${d.avg_engagement} avg engagement`}
                style={{
                  width: "100%", maxWidth: 26, height: Math.max(3, (d.avg_engagement / max) * 56),
                  borderRadius: 3, background: "var(--secondary)", opacity: d.avg_engagement === 0 ? 0.2 : 1,
                }}
              />
              <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{d.weekday}</span>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 12.5, color: "var(--text-muted)" }}>No engagement data yet — hit Refresh to pull likes/comments.</p>
      )}
    </div>
  );
}

function EngagementByCategorySection({ categories }) {
  return (
    <div
      style={{
        background: "var(--paper-raised)", border: "0.5px solid var(--border-strong)",
        borderRadius: 8, padding: "14px 16px", flex: "1 1 260px",
      }}
    >
      <div style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500, marginBottom: 12 }}>Engagement by category</div>
      {(!categories || categories.length === 0) && (
        <p style={{ fontSize: 12.5, color: "var(--text-muted)" }}>No engagement data yet — hit Refresh to pull likes/comments.</p>
      )}
      {(categories || []).map((c) => {
        const max = Math.max(1, ...categories.map((x) => x.avg_engagement));
        return (
          <div key={c.category} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 12.5, color: "var(--ink)", width: 90, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.category}
            </span>
            <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
              <div
                style={{
                  width: `${(c.avg_engagement / max) * 100}%`, height: "100%",
                  background: "var(--accent)", borderRadius: 3,
                }}
              />
            </div>
            <span style={{ fontSize: 12, color: "var(--text-muted)", width: 34, textAlign: "right" }}>{c.avg_engagement}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function Analytics({ token, onAuthError, days: daysProp, onDaysChange }) {
  const [daysState, setDaysState] = useState(30);
  const days = daysProp ?? daysState;
  const setDays = onDaysChange ?? setDaysState;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(null);

  function load() {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAnalyticsSummary({ token, days })
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e) => {
        if (cancelled) return;
        if (e.status === 401) return onAuthError?.();
        setError(e.message || "Failed to load analytics");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }

  useEffect(load, [token, days]);

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      await refreshAnalytics({ token });
      load();
    } catch (e) {
      if (e.status === 401) return onAuthError?.();
      setRefreshError(e.message || "Couldn't refresh follower/engagement data.");
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) {
    return <div style={{ padding: "3rem 0", textAlign: "center", color: "var(--text-secondary)" }}>Loading analytics…</div>;
  }
  if (error) {
    return <div style={{ padding: "2rem", color: "var(--danger)" }}>{error}</div>;
  }
  if (!data) return null;

  const platformEntries = Object.entries(data.by_platform || {});
  const maxPlatformTotal = Math.max(1, ...platformEntries.map(([, v]) => v.total));
  const followerEntries = Object.entries(data.current_followers || {});

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <p style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--ink)", margin: 0 }}>Analytics</p>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {refreshError && <span style={{ fontSize: 12, color: "var(--danger)" }}>{refreshError}</span>}
          <button onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {followerEntries.length > 0 && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
          {followerEntries.map(([key, count]) => (
            <FollowerCard key={key} platformKey={key} count={count} series={(data.follower_growth || {})[key]} />
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <MetricCard
          label="Total drafts"
          value={data.total_drafts}
        />
        <MetricCard
          label="Total publishes"
          value={data.successes}
          daily={data.daily}
          metric="success"
        />
        <MetricCard
          label="Currently scheduled"
          value={data.currently_scheduled}
        />
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div
          style={{
            background: "var(--paper-raised)", border: "0.5px solid var(--border-strong)",
            borderRadius: 8, padding: "14px 16px", flex: "1 1 260px",
          }}
        >
          <div style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500, marginBottom: 12 }}>By platform</div>
          {platformEntries.length === 0 && (
            <p style={{ fontSize: 12.5, color: "var(--text-muted)" }}>No publish attempts in this range.</p>
          )}
          {platformEntries.map(([key, v]) => {
            const p = platformByKey(key);
            return (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                {p ? <PlatformLogo platform={p} size={14} /> : null}
                <span style={{ fontSize: 12.5, color: "var(--ink)", width: 70, flexShrink: 0 }}>{p?.label || key}</span>
                <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${(v.total / maxPlatformTotal) * 100}%`, height: "100%",
                      background: "var(--accent)", borderRadius: 3,
                    }}
                  />
                </div>
                <span style={{ fontSize: 12, color: "var(--text-muted)", width: 60, textAlign: "right" }}>
                  {v.success}/{v.total}
                </span>
              </div>
            );
          })}
        </div>

        <div
          style={{
            background: "var(--paper-raised)", border: "0.5px solid var(--border-strong)",
            borderRadius: 8, padding: "14px 16px", flex: "1 1 260px",
          }}
        >
          <div style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500, marginBottom: 12 }}>Top categories</div>
          {(!data.top_categories || data.top_categories.length === 0) && (
            <p style={{ fontSize: 12.5, color: "var(--text-muted)" }}>No published categories in this range.</p>
          )}
          {(data.top_categories || []).map((c) => {
            const max = Math.max(1, ...data.top_categories.map((x) => x.count));
            return (
              <div key={c.category} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 12.5, color: "var(--ink)", width: 90, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.category}
                </span>
                <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${(c.count / max) * 100}%`, height: "100%",
                      background: "var(--secondary)", borderRadius: 3,
                    }}
                  />
                </div>
                <span style={{ fontSize: 12, color: "var(--text-muted)", width: 20, textAlign: "right" }}>{c.count}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
        <div
          style={{
            background: "var(--paper-raised)", border: "0.5px solid var(--border-strong)",
            borderRadius: 8, padding: "14px 16px", flex: "1 1 260px",
          }}
        >
          <div style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500, marginBottom: 12 }}>Posting cadence</div>
          {data.cadence_by_weekday && data.cadence_by_weekday.some((d) => d.count > 0) ? (
            <CadenceChart cadence={data.cadence_by_weekday} />
          ) : (
            <p style={{ fontSize: 12.5, color: "var(--text-muted)" }}>No successful publishes in this range.</p>
          )}
        </div>

        <div
          style={{
            background: "var(--paper-raised)", border: "0.5px solid var(--border-strong)",
            borderRadius: 8, padding: "14px 16px", flex: "1 1 260px",
          }}
        >
          <div style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500, marginBottom: 4 }}>Platform reliability over time</div>
          <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 0, marginBottom: 12 }}>
            Each bar is a day — green = all attempts succeeded, amber = mixed, red = all failed.
          </p>
          {Object.keys(data.platform_reliability_daily || {}).length === 0 ? (
            <p style={{ fontSize: 12.5, color: "var(--text-muted)" }}>No publish attempts in this range.</p>
          ) : (
            Object.entries(data.platform_reliability_daily).map(([key, entries]) => (
              <PlatformReliabilityRow key={key} platformKey={key} entries={entries} />
            ))
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
        <EngagementByWeekdaySection weekday={data.engagement_by_weekday} />
        <EngagementByCategorySection categories={data.engagement_by_category} />
      </div>

      <TopPostsSection posts={data.top_posts} />

      {data.recent_failures && data.recent_failures.length > 0 && (
        <div
          style={{
            marginTop: 12, background: "var(--paper-raised)", border: "0.5px solid var(--border-strong)",
            borderRadius: 8, padding: "14px 16px",
          }}
        >
          <div style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500, marginBottom: 12 }}>Recent failures</div>
          {data.recent_failures.map((f, i) => {
            const p = platformByKey(f.platform);
            return (
              <div
                key={i}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 8, padding: "7px 0",
                  borderTop: i > 0 ? "0.5px solid var(--border)" : "none",
                }}
              >
                {p ? <PlatformLogo platform={p} size={13} /> : null}
                <span style={{ fontSize: 12, color: "var(--danger)", flex: 1 }}>{f.detail || "Unknown error"}</span>
                <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
                  {new Date(f.published_at).toLocaleDateString()}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}