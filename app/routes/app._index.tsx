import { PermissionName } from "@prisma/client";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticateAdminOrFallback } from "../shopify.server";
import db from "../db.server";
import { ensureShopOwnerMembership, normalizeShopDomain } from "../services/shop.service.server";
import { hasPermission, resolveShopUser } from "../services/authorization.server";
import { loadDashboard } from "../services/dashboard.server";
import { DASHBOARD_RANGES } from "../lib/dashboard-ranges";
import type { DashboardRange } from "../lib/dashboard-ranges";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticateAdminOrFallback(request);
  const shop = await db.shop.findUnique({ where: { domain: normalizeShopDomain(session.shop) } });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  await ensureShopOwnerMembership(shop.id, admin);

  const email = session.onlineAccessInfo?.associated_user?.email?.trim().toLowerCase();
  const user = await resolveShopUser({ shopId: shop.id, email });
  if (!user) throw new Response("Access denied", { status: 403 });

  const canRead = await hasPermission({ userId: user.id, shopId: shop.id, permission: PermissionName.TICKETS_READ });
  if (!canRead) throw new Response("Access denied", { status: 403 });

  const requested = Number(new URL(request.url).searchParams.get("range"));
  const range = (DASHBOARD_RANGES as readonly number[]).includes(requested) ? (requested as DashboardRange) : 30;

  return { shopName: shop.name, dashboard: await loadDashboard(shop.id, range) };
};

/* ---------- formatting ---------- */

function formatDuration(ms: number | null) {
  if (ms === null) return "–";
  const minutes = ms / 60000;
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

function formatPercent(value: number | null) {
  return value === null ? "–" : `${Math.round(value * 100)}%`;
}

function formatDelta(current: number, previous: number) {
  if (previous === 0) return current === 0 ? "no change" : "new activity";
  const change = Math.round(((current - previous) / previous) * 100);
  return `${change > 0 ? "+" : ""}${change}% vs previous period`;
}

function shortDate(iso: string) {
  const [, month, day] = iso.split("-");
  return `${Number(day)}.${Number(month)}.`;
}

/* ---------- building blocks ---------- */

const font = "Inter, system-ui, sans-serif";
const card = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20 } as const;
const tones = {
  neutral: "#111827",
  good: "#15803d",
  warn: "#b45309",
  bad: "#b91c1c",
} as const;

function Kpi({
  label,
  value,
  hint,
  tone = "neutral",
  to,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: keyof typeof tones;
  to?: string;
}) {
  const body = (
    <div style={{ ...card, height: "100%", boxSizing: "border-box" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ fontSize: 30, fontWeight: 700, color: tones[tone], margin: "6px 0 2px" }}>{value}</div>
      {hint ? <div style={{ fontSize: 12, color: "#6b7280" }}>{hint}</div> : null}
    </div>
  );
  return to ? (
    <Link to={to} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
      {body}
    </Link>
  ) : (
    body
  );
}

function Grid({ children, min = 200 }: { children: React.ReactNode; min?: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 16 }}>
      {children}
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, color: "#111827" }}>{title}</h2>
      {subtitle ? <p style={{ margin: "0 0 14px", fontSize: 13, color: "#6b7280" }}>{subtitle}</p> : <div style={{ height: 14 }} />}
      {children}
    </section>
  );
}

function BarList({ rows, color = "#4f46e5", empty }: { rows: { name: string; count: number }[]; color?: string; empty: string }) {
  if (rows.length === 0) return <div style={{ fontSize: 13, color: "#9ca3af" }}>{empty}</div>;
  const max = Math.max(...rows.map((row) => row.count));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((row) => (
        <div key={row.name}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 3 }}>
            <span style={{ color: "#374151", overflowWrap: "anywhere" }}>{row.name}</span>
            <span style={{ color: "#111827", fontWeight: 600 }}>{row.count}</span>
          </div>
          <div style={{ background: "#f3f4f6", borderRadius: 4, height: 8 }}>
            <div style={{ width: `${(row.count / max) * 100}%`, background: color, borderRadius: 4, height: 8 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function VolumeChart({ days }: { days: { date: string; created: number; resolved: number }[] }) {
  const width = 720;
  const height = 160;
  const max = Math.max(1, ...days.flatMap((day) => [day.created, day.resolved]));
  const slot = width / days.length;
  const bar = Math.max(1, Math.min(14, slot / 2 - 1));
  const total = days.reduce((sum, day) => sum + day.created, 0);

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height + 18}`}
        role="img"
        aria-label={`New and resolved tickets per day, ${total} new in total`}
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        {[0.25, 0.5, 0.75, 1].map((fraction) => (
          <line key={fraction} x1={0} x2={width} y1={height - height * fraction} y2={height - height * fraction} stroke="#f3f4f6" />
        ))}
        {days.map((day, index) => {
          const x = index * slot + slot / 2;
          const createdHeight = (day.created / max) * height;
          const resolvedHeight = (day.resolved / max) * height;
          return (
            <g key={day.date}>
              <title>{`${shortDate(day.date)}: ${day.created} new, ${day.resolved} resolved`}</title>
              <rect x={x - bar - 0.5} y={height - createdHeight} width={bar} height={createdHeight} fill="#4f46e5" rx={1} />
              <rect x={x + 0.5} y={height - resolvedHeight} width={bar} height={resolvedHeight} fill="#16a34a" rx={1} />
            </g>
          );
        })}
        <text x={0} y={height + 14} fontSize={11} fill="#6b7280">{shortDate(days[0].date)}</text>
        <text x={width} y={height + 14} fontSize={11} fill="#6b7280" textAnchor="end">{shortDate(days[days.length - 1].date)}</text>
      </svg>
      <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#6b7280", marginTop: 6 }}>
        <span><span style={{ color: "#4f46e5" }}>■</span> New</span>
        <span><span style={{ color: "#16a34a" }}>■</span> Resolved</span>
        <span style={{ marginLeft: "auto" }}>Peak: {max} per day</span>
      </div>
    </div>
  );
}

/* ---------- page ---------- */

export default function Dashboard() {
  const { shopName, dashboard: d } = useLoaderData<typeof loader>();
  const a = d.attention;

  const checklist = [
    { done: d.setup.supportEmail, label: "Set the support email address", to: "/app/settings/email" },
    { done: d.setup.knowledge, label: "Add knowledge documents for the AI", to: "/app/ai/knowledge" },
    { done: d.setup.instructions, label: "Write at least one AI instruction", to: "/app/ai/instructions" },
    { done: d.setup.firstTicket, label: "Receive the first customer email", to: "/app/inbox" },
  ];
  const setupIncomplete = checklist.some((item) => !item.done);

  const decisionRows = [
    { name: "Sent automatically", count: d.ai.decisions.AUTO_SEND },
    { name: "Draft for human review", count: d.ai.decisions.HUMAN_REVIEW },
    { name: "Escalated", count: d.ai.decisions.ESCALATE },
    { name: "No reply needed", count: d.ai.decisions.NO_RESPONSE },
  ];

  return (
    <div style={{ fontFamily: font, maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "#111827" }}>Dashboard</h1>
          <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 14 }}>{shopName}</p>
        </div>
        <div role="group" aria-label="Time range" style={{ display: "flex", gap: 4 }}>
          {DASHBOARD_RANGES.map((range) => (
            <Link
              key={range}
              to={`?range=${range}`}
              aria-current={d.rangeDays === range ? "true" : undefined}
              style={{
                padding: "6px 14px",
                borderRadius: 20,
                fontSize: 13,
                fontWeight: 500,
                textDecoration: "none",
                background: d.rangeDays === range ? "#4f46e5" : "#f3f4f6",
                color: d.rangeDays === range ? "#fff" : "#374151",
                border: "1px solid",
                borderColor: d.rangeDays === range ? "#4f46e5" : "#e5e7eb",
              }}
            >
              {range} days
            </Link>
          ))}
        </div>
      </div>

      {setupIncomplete ? (
        <div style={{ ...card, background: "#f5f3ff", borderColor: "#ddd6fe", marginBottom: 32 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#4c1d95", marginBottom: 8 }}>Finish setting up</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {checklist.map((item) => (
              <div key={item.label} style={{ fontSize: 14, color: item.done ? "#6b7280" : "#111827" }}>
                <span aria-hidden="true">{item.done ? "✅" : "⬜"}</span>{" "}
                <span style={{ textDecoration: item.done ? "line-through" : "none" }}>
                  {item.done ? item.label : <Link to={item.to} style={{ color: "#4f46e5" }}>{item.label}</Link>}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <Section title="Needs attention" subtitle="Live status of the queue, regardless of the selected period.">
        <Grid>
          <Kpi label="Waiting for our reply" value={a.needsReply} hint="New, open or waiting for an agent" tone={a.needsReply > 0 ? "warn" : "good"} to="/app/inbox" />
          <Kpi label="Oldest unanswered" value={formatDuration(a.oldestNeedingReplyMs)} hint="Age of the longest waiting ticket" tone={a.oldestNeedingReplyMs !== null && a.oldestNeedingReplyMs > 24 * 3600000 ? "bad" : "neutral"} />
          <Kpi label="Unassigned" value={a.unassigned} hint="Open tickets with no owner" tone={a.unassigned > 0 ? "warn" : "good"} to="/app/inbox?filter=unassigned" />
          <Kpi label="High priority" value={a.highPriority} hint="Open, high or urgent" tone={a.highPriority > 0 ? "bad" : "good"} to="/app/inbox?filter=high_priority" />
          <Kpi label="Waiting for customer" value={a.waitingCustomer} hint="We have answered" to="/app/inbox?filter=waiting" />
          <Kpi label="Open tickets" value={a.open} hint="All unresolved tickets" to="/app/inbox" />
          <Kpi label="Actions to approve" value={a.pendingApprovals} hint="Proposed by the AI, e.g. refunds" tone={a.pendingApprovals > 0 ? "warn" : "neutral"} to="/app/action-policies" />
          <Kpi label="Active incidents" value={a.activeIncidents} hint="Unresolved incident groups" tone={a.activeIncidents > 0 ? "bad" : "neutral"} to="/app/incidents" />
        </Grid>
      </Section>

      <Section title={`Last ${d.rangeDays} days`} subtitle="Volume and how quickly customers get an answer.">
        <Grid>
          <Kpi label="New tickets" value={d.volume.created} hint={formatDelta(d.volume.created, d.volume.createdPrevious)} />
          <Kpi label="Resolved" value={d.volume.resolved} hint={d.volume.created > 0 ? `${formatPercent(d.volume.resolved / d.volume.created)} of new tickets` : undefined} tone="good" />
          <Kpi label="Median first response" value={formatDuration(d.speed.medianFirstResponseMs)} hint={d.speed.answeredShare !== null ? `${formatPercent(d.speed.answeredShare)} of new tickets answered` : "No new tickets"} />
          <Kpi label="Median resolution time" value={formatDuration(d.speed.medianResolutionMs)} hint={d.speed.resolutionSamples > 0 ? `Based on ${d.speed.resolutionSamples} resolved tickets` : "Collected from now on, no resolved tickets yet"} />
        </Grid>
        <div style={{ ...card, marginTop: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#111827", marginBottom: 12 }}>Tickets per day</div>
          <VolumeChart days={d.volume.days} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginTop: 16 }}>
          <div style={card}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#111827", marginBottom: 12 }}>What customers write about</div>
            <BarList rows={d.volume.categories} empty="No tickets in this period." />
          </div>
          <div style={card}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#111827", marginBottom: 12 }}>Open tickets per person</div>
            <BarList rows={d.workload} color="#0891b2" empty="No open tickets." />
          </div>
        </div>
      </Section>

      <Section title="AI assistant" subtitle={`How the AI performed over the last ${d.rangeDays} days.`}>
        <Grid>
          <Kpi label="Drafts generated" value={d.ai.drafts} hint="AI runs on tickets" />
          <Kpi label="Sent automatically" value={formatPercent(d.ai.autoSendShare)} hint="Share needing no human review" />
          <Kpi label="Agent rating" value={formatPercent(d.ai.positiveShare)} hint={d.ai.feedbackCount > 0 ? `${d.ai.feedbackCount} ratings, share positive` : "No ratings yet"} tone={d.ai.positiveShare !== null && d.ai.positiveShare < 0.6 ? "warn" : "neutral"} />
          <Kpi label="Average confidence" value={formatPercent(d.ai.avgConfidence)} hint="The AI's own certainty" />
          <Kpi label="Knowledge gaps" value={a.openGaps} hint="Questions the AI could not answer" tone={a.openGaps > 0 ? "warn" : "good"} to="/app/ai/knowledge" />
          <Kpi label="AI cost" value={`$${d.ai.cost.toFixed(2)}`} hint={d.ai.avgLatencyMs !== null ? `Avg. ${(d.ai.avgLatencyMs / 1000).toFixed(1)} s per draft` : "Estimated"} />
        </Grid>
        <div style={{ ...card, marginTop: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#111827", marginBottom: 12 }}>What the AI decided</div>
          <BarList rows={decisionRows} color="#7c3aed" empty="No AI runs in this period." />
        </div>
      </Section>
    </div>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
