import { useEffect, useRef, useState } from "react";
import { Form, Link, useActionData, useLoaderData, useLocation, useNavigation, useSearchParams } from "react-router";
import type { TicketStatus } from "@prisma/client";
import type { TicketActionError, TicketPageData, TicketUpdateKind } from "../services/ticket-page.server";

// Mirrors the Prisma enum; a runtime import of @prisma/client would pull Prisma into the browser bundle.
const TICKET_STATUSES: TicketStatus[] = ["NEW", "OPEN", "WAITING_FOR_CUSTOMER", "WAITING_FOR_AGENT", "RESOLVED", "CLOSED"];

function describeUpdates(updated: string, ticket: TicketPageData) {
  if (updated === "none") return null;
  const labels: Record<TicketUpdateKind, string> = {
    reply: "reply sent",
    note: "internal note added",
    status: `status set to ${ticket.status}`,
    priority: `priority set to ${ticket.priority}`,
    assignee: ticket.assignee ? `assigned to ${ticket.assignee.name ?? ticket.assignee.email}` : "unassigned",
  };
  const parts = updated
    .split(",")
    .map((kind) => labels[kind as TicketUpdateKind])
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

// Splits an email body into the new text and the quoted history below it, so long
// "> ..." threads and "On ... wrote:" blocks can be collapsed.
const QUOTE_START = /^\s*>/;
const ATTRIBUTION = /\b(wrote|skrev)\b.*:\s*$|\b(wrote|skrev)\s*:?\s*$/i;
const ORIGINAL_MARKER = /^\s*(-{2,}\s*(Original Message|Opprinnelig melding|Videresendt melding)|_{10,}|(Fra|From):\s.+)/i;

function splitQuotedText(body: string): { fresh: string; quoted: string } {
  const lines = body.split(/\r?\n/);
  let start = lines.findIndex((line) => QUOTE_START.test(line) || ORIGINAL_MARKER.test(line));
  if (start === -1) return { fresh: body, quoted: "" };

  // Pull the "On <date>, <name> wrote:" attribution (it may wrap over two lines) into the quoted part.
  let prev = start - 1;
  while (prev >= 0 && lines[prev].trim() === "") prev--;
  if (prev >= 0 && ATTRIBUTION.test(lines[prev])) {
    start = prev;
    if (start > 0 && /^\s*(On|Den)\s/i.test(lines[start - 1])) start -= 1;
  }

  return {
    fresh: lines.slice(0, start).join("\n").trim(),
    quoted: lines.slice(start).join("\n").trim(),
  };
}

// HTML mail is shown in a sandboxed iframe: no scripts, no forms, no top navigation (links may open a new tab),
// and a CSP that only allows inline styles and https images.
function SandboxedHtml({ html }: { html: string }) {
  const doc =
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'">` +
    `<base target="_blank"><style>body{font-family:system-ui,sans-serif;font-size:14px;margin:8px;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style>` +
    html;
  return (
    <iframe
      title="Original email"
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
      style={{ width: "100%", height: "480px", border: "1px solid #e2e8f0", borderRadius: "8px", background: "#ffffff" }}
    />
  );
}

// Plain text with http(s) links turned into real links (the mail body is stored as text).
const URL_PATTERN = /(https?:\/\/[^\s<>"]+)/g;

function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_PATTERN);
  return (
    <>
      {parts.map((part, index) => {
        if (index % 2 === 0) return part;
        // Trailing punctuation belongs to the sentence, not the address.
        const trailing = part.match(/[.,;:!?)\]]+$/)?.[0] ?? "";
        const href = trailing ? part.slice(0, -trailing.length) : part;
        return (
          <span key={index}>
            <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb" }}>
              {href}
            </a>
            {trailing}
          </span>
        );
      })}
    </>
  );
}

type TicketAttachment = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number | null;
  previewKind: "image" | "pdf" | "text" | null;
  viewUrl: string;
  downloadUrl: string;
};

function formatFileSize(bytes: number | null) {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentViewer({ attachment, onClose }: { attachment: TicketAttachment; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const button = {
    padding: "6px 12px",
    fontSize: "13px",
    fontWeight: 600,
    borderRadius: "6px",
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#0f172a",
    cursor: "pointer",
    textDecoration: "none",
  } as const;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${attachment.filename}`}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: "rgba(15, 23, 42, 0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          background: "#ffffff",
          borderRadius: "12px",
          width: "min(1000px, 100%)",
          height: "min(90vh, 900px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "12px 16px", borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: "14px", color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {attachment.filename}
          </div>
          <a href={attachment.downloadUrl} style={button}>Download</a>
          {attachment.previewKind ? (
            <a href={attachment.viewUrl} target="_blank" rel="noopener noreferrer" style={button}>Open in new tab</a>
          ) : null}
          <button type="button" autoFocus onClick={onClose} style={button}>Close</button>
        </div>
        <div style={{ flex: 1, minHeight: 0, background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {attachment.previewKind === "image" ? (
            <img src={attachment.viewUrl} alt={attachment.filename} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
          ) : attachment.previewKind ? (
            <iframe title={attachment.filename} src={attachment.viewUrl} style={{ width: "100%", height: "100%", border: "none", background: "#ffffff" }} />
          ) : (
            <div style={{ padding: "24px", textAlign: "center", color: "#475569", fontSize: "14px" }}>
              This file type can't be previewed here.
              <div style={{ marginTop: "12px" }}>
                <a href={attachment.downloadUrl} style={{ ...button, display: "inline-block" }}>Download {attachment.filename}</a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AttachmentList({ attachments }: { attachments: TicketAttachment[] }) {
  const [open, setOpen] = useState<TicketAttachment | null>(null);
  if (attachments.length === 0) return null;

  return (
    <div style={{ marginTop: "12px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          style={{ display: "flex", alignItems: "center", gap: "8px", border: "1px solid #cbd5e1", borderRadius: "8px", background: "#ffffff", padding: "6px 10px", maxWidth: "100%" }}
        >
          {attachment.previewKind === "image" ? (
            <img src={attachment.viewUrl} alt="" loading="lazy" width={40} height={40} style={{ objectFit: "cover", borderRadius: "4px" }} />
          ) : (
            <span aria-hidden="true" style={{ fontSize: "22px" }}>{attachment.previewKind === "pdf" ? "📄" : "📎"}</span>
          )}
          <div style={{ minWidth: 0 }}>
            <button
              type="button"
              onClick={() => setOpen(attachment)}
              style={{ display: "block", background: "none", border: "none", padding: 0, cursor: "pointer", color: "#1d4ed8", fontSize: "13px", fontWeight: 600, textAlign: "left", overflowWrap: "anywhere" }}
            >
              {attachment.filename}
            </button>
            <span style={{ fontSize: "11px", color: "#64748b" }}>{formatFileSize(attachment.sizeBytes)}</span>
          </div>
          <a href={attachment.downloadUrl} aria-label={`Download ${attachment.filename}`} style={{ fontSize: "12px", color: "#475569", marginLeft: "4px" }}>
            Download
          </a>
        </div>
      ))}
      {open ? <AttachmentViewer attachment={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function MessageBody({ body, bodyHtml, attachments }: { body: string; bodyHtml: string | null; attachments: TicketAttachment[] }) {
  const [showQuoted, setShowQuoted] = useState(false);
  const [showHtml, setShowHtml] = useState(false);
  const { fresh, quoted } = splitQuotedText(body);
  const linkButton = {
    background: "none",
    border: "none",
    padding: 0,
    marginRight: "16px",
    color: "#2563eb",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
  } as const;

  return (
    <div style={{ fontSize: "14px", lineHeight: "1.6", color: "#1e293b" }}>
      <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word" }}>
        {fresh ? <Linkified text={fresh} /> : quoted ? <span style={{ color: "#94a3b8" }}>(no new text, only quoted history)</span> : <Linkified text={body} />}
      </div>

      {quoted || bodyHtml ? (
        <div style={{ marginTop: "8px" }}>
          {quoted ? (
            <button type="button" style={linkButton} onClick={() => setShowQuoted((value) => !value)}>
              {showQuoted ? "Hide quoted text" : "Show quoted text"}
            </button>
          ) : null}
          {bodyHtml ? (
            <button type="button" style={linkButton} onClick={() => setShowHtml((value) => !value)}>
              {showHtml ? "Hide original email" : "View original email"}
            </button>
          ) : null}
        </div>
      ) : null}

      {showQuoted && quoted ? (
        <div
          style={{
            marginTop: "8px",
            paddingLeft: "12px",
            borderLeft: "3px solid #cbd5e1",
            color: "#64748b",
            fontSize: "13px",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            wordBreak: "break-word",
          }}
        >
          <Linkified text={quoted} />
        </div>
      ) : null}
      <AttachmentList attachments={attachments} />
      {showHtml && bodyHtml ? (
        <div style={{ marginTop: "8px" }}>
          <SandboxedHtml html={bodyHtml} />
        </div>
      ) : null}
    </div>
  );
}

// Confirms the last save, using the `?updated=` param set by handleTicketPageAction.
function UpdateNotice({ ticket }: { ticket: TicketPageData }) {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const updated = searchParams.get("updated");

  useEffect(() => {
    if (!updated) return;
    const timer = setTimeout(() => setDismissedKey(location.key), 5000);
    return () => clearTimeout(timer);
  }, [updated, location.key]);

  if (!updated || dismissedKey === location.key) return null;

  const summary = describeUpdates(updated, ticket);
  const success = summary !== null;

  return (
    <div
      role="status"
      style={{
        position: "fixed",
        top: "16px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        gap: "12px",
        maxWidth: "calc(100% - 32px)",
        padding: "10px 16px",
        fontSize: "13px",
        fontWeight: 600,
        borderRadius: "8px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
        backgroundColor: success ? "#dcfce7" : "#f1f5f9",
        color: success ? "#166534" : "#475569",
        border: `1px solid ${success ? "#86efac" : "#cbd5e1"}`,
      }}
    >
      <span>{success ? `✓ Ticket updated: ${summary}` : "No changes to save."}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissedKey(location.key)}
        style={{ background: "none", border: "none", cursor: "pointer", fontSize: "16px", lineHeight: 1, color: "inherit" }}
      >
        ×
      </button>
    </div>
  );
}

export function TicketPage() {
  const ticket = useLoaderData<TicketPageData>();
  const actionData = useActionData<TicketActionError | undefined>();
  const navigation = useNavigation();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // Clear the reply and note fields once they have been saved. A failed send returns the error on the
  // same page without navigating, so the typed text is kept in that case.
  const [replyFormKey, setReplyFormKey] = useState(0);
  const clearedFor = useRef<string | null>(null);
  const savedKinds = searchParams.get("updated") ?? "";
  useEffect(() => {
    const savedText = savedKinds.split(",").some((kind) => kind === "reply" || kind === "note");
    if (savedText && clearedFor.current !== location.key) {
      clearedFor.current = location.key;
      setReplyFormKey((key) => key + 1);
    }
  }, [savedKinds, location.key]);
  const isSavingProperties = navigation.state !== "idle" && navigation.formData?.has("priority") === true;

  const statusColors: Record<string, { bg: string; text: string }> = {
    NEW: { bg: "#dbeafe", text: "#1e40af" },
    OPEN: { bg: "#dcfce7", text: "#166534" },
    WAITING_FOR_CUSTOMER: { bg: "#fef9c3", text: "#854d0e" },
    WAITING_FOR_AGENT: { bg: "#ffedd5", text: "#9a3412" },
    RESOLVED: { bg: "#f3e8ff", text: "#6b21a8" },
    CLOSED: { bg: "#f3f4f6", text: "#374151" },
  };

  const priorityColors: Record<string, { bg: string; text: string }> = {
    LOW: { bg: "#f3f4f6", text: "#4b5563" },
    NORMAL: { bg: "#e0f2fe", text: "#0369a1" },
    HIGH: { bg: "#ffedd5", text: "#c2410c" },
    URGENT: { bg: "#fee2e2", text: "#b91c1c" },
  };

  const currentStatusStyle = statusColors[ticket.status] || { bg: "#f3f4f6", text: "#374151" };
  const currentPriorityStyle = priorityColors[ticket.priority] || { bg: "#f3f4f6", text: "#374151" };

  return (
    <div
      style={{
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        minHeight: "100vh",
        backgroundColor: "#f4f5f7",
        color: "#172b4d",
        padding: "24px 32px",
      }}
    >
      <UpdateNotice ticket={ticket} />
      {actionData?.sendError ? (
        <div
          role="alert"
          style={{
            maxWidth: "1280px",
            margin: "0 auto 16px",
            padding: "12px 16px",
            fontSize: "14px",
            fontWeight: 600,
            borderRadius: "8px",
            backgroundColor: "#fee2e2",
            color: "#991b1b",
            border: "1px solid #fca5a5",
          }}
        >
          {actionData.sendError}
        </div>
      ) : null}
      <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
        <div style={{ marginBottom: "20px" }}>
          <div style={{ marginBottom: "12px" }}>
            <Link
              to={ticket.backPath}
              style={{
                fontSize: "13px",
                color: "#475569",
                textDecoration: "none",
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              {ticket.backPath.startsWith("/app") ? "← Back to Inbox" : "← Back to Portal Dashboard"}
            </Link>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              backgroundColor: "#ffffff",
              padding: "20px 24px",
              borderRadius: "12px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                <span style={{ fontSize: "14px", fontWeight: 700, color: "#64748b" }}>
                  {ticket.ticketNumber}
                </span>
                <span
                  style={{
                    padding: "3px 10px",
                    fontSize: "12px",
                    fontWeight: 700,
                    borderRadius: "12px",
                    backgroundColor: currentStatusStyle.bg,
                    color: currentStatusStyle.text,
                  }}
                >
                  {ticket.status}
                </span>
                <span
                  style={{
                    padding: "3px 10px",
                    fontSize: "12px",
                    fontWeight: 700,
                    borderRadius: "12px",
                    backgroundColor: currentPriorityStyle.bg,
                    color: currentPriorityStyle.text,
                  }}
                >
                  {ticket.priority}
                </span>
                <span style={{ fontSize: "12px", color: "#94a3b8" }}>Source: {ticket.source}</span>
              </div>
              <h1 style={{ fontSize: "22px", fontWeight: 700, margin: 0, color: "#0f172a" }}>
                {ticket.subject}
              </h1>
            </div>

            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <Form method="post">
                <input type="hidden" name="intent" value={ticket.isFollowing ? "unfollow" : "follow"} />
                <button
                  type="submit"
                  style={{
                    padding: "8px 16px",
                    fontSize: "13px",
                    fontWeight: 600,
                    borderRadius: "8px",
                    border: "1px solid #cbd5e1",
                    backgroundColor: ticket.isFollowing ? "#eff6ff" : "#ffffff",
                    color: ticket.isFollowing ? "#1d4ed8" : "#475569",
                    cursor: "pointer",
                  }}
                >
                  {ticket.isFollowing ? "★ Following" : "☆ Follow ticket"}
                </button>
              </Form>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 340px", gap: "24px", alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: 0 }}>
            <div
              style={{
                backgroundColor: "#ffffff",
                padding: "24px",
                borderRadius: "12px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
              }}
            >
              <h2 style={{ fontSize: "16px", fontWeight: 700, margin: "0 0 20px 0", color: "#0f172a" }}>
                Conversation Thread ({ticket.messages.length})
              </h2>

              {ticket.messages.length === 0 ? (
                <div style={{ padding: "24px", textAlign: "center", color: "#64748b", fontSize: "14px" }}>
                  No customer messages in this thread yet.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {ticket.messages.map((msg: {
                    id: string;
                    body: string;
                    bodyHtml: string | null;
                    attachments: TicketAttachment[];
                    senderType: string;
                    isIncoming: boolean;
                    createdAt: string;
                  }) => (
                    <div
                      key={msg.id}
                      style={{
                        padding: "16px 20px",
                        borderRadius: "12px",
                        backgroundColor: msg.isIncoming ? "#f8fafc" : "#eff6ff",
                        border: msg.isIncoming ? "1px solid #e2e8f0" : "1px solid #bfdbfe",
                        alignSelf: msg.isIncoming ? "flex-start" : "flex-end",
                        width: "90%",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: "12px",
                          fontWeight: 600,
                          color: msg.isIncoming ? "#475569" : "#1e40af",
                          marginBottom: "8px",
                        }}
                      >
                        <span>
                          {msg.isIncoming ? "👤 Customer" : "👨‍💼 Support Agent"} · {msg.senderType}
                        </span>
                        <span>{new Date(msg.createdAt).toLocaleString()}</span>
                      </div>
                      <MessageBody body={msg.body} bodyHtml={msg.bodyHtml} attachments={msg.attachments} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {ticket.internalNotes.length > 0 ? (
              <div
                style={{
                  backgroundColor: "#fffbeb",
                  border: "1px solid #fde68a",
                  padding: "20px",
                  borderRadius: "12px",
                }}
              >
                <h3 style={{ fontSize: "14px", fontWeight: 700, margin: "0 0 12px 0", color: "#92400e" }}>
                  🔒 Internal Notes ({ticket.internalNotes.length})
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {ticket.internalNotes.map((note: { id: string; authorName: string; body: string; createdAt: string }) => (
                    <div
                      key={note.id}
                      style={{
                        padding: "12px 16px",
                        backgroundColor: "#ffffff",
                        borderRadius: "8px",
                        border: "1px solid #fef3c7",
                      }}
                    >
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "#78350f", marginBottom: "4px" }}>
                        {note.authorName} · {new Date(note.createdAt).toLocaleString()}
                      </div>
                      <div style={{ fontSize: "14px", color: "#1e293b", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{note.body}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {ticket.aiSuggestion ? (
              <div
                style={{
                  backgroundColor: "#f0fdf4",
                  border: "1.5px solid #86efac",
                  padding: "24px",
                  borderRadius: "12px",
                  boxShadow: "0 4px 16px rgba(16, 185, 129, 0.08)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "18px" }}>✨</span>
                    <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#166534", margin: 0 }}>
                      AI Suggested Reply (Copilot Mode)
                    </h3>
                  </div>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      padding: "3px 8px",
                      backgroundColor: "#dcfce7",
                      color: "#15803d",
                      borderRadius: "6px",
                    }}
                  >
                    Human Review Required
                  </span>
                </div>

                <div
                  style={{
                    backgroundColor: "#ffffff",
                    padding: "16px",
                    borderRadius: "8px",
                    border: "1px solid #bbf7d0",
                    fontSize: "14px",
                    lineHeight: "1.6",
                    color: "#0f172a",
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    marginBottom: "16px",
                  }}
                >
                  {ticket.aiSuggestion}
                </div>

                <Form method="post">
                  <input type="hidden" name="intent" value="approve-ai" />
                  <input type="hidden" name="aiSuggestion" value={ticket.aiSuggestion} />
                  <button
                    type="submit"
                    style={{
                      padding: "10px 20px",
                      fontSize: "14px",
                      fontWeight: 700,
                      backgroundColor: "#16a34a",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "8px",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "8px",
                      boxShadow: "0 2px 6px rgba(22, 163, 74, 0.2)",
                    }}
                  >
                    ✨ Approve &amp; Send to Customer
                  </button>
                </Form>
              </div>
            ) : null}

            <div
              style={{
                backgroundColor: "#ffffff",
                padding: "24px",
                borderRadius: "12px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <h3 style={{ fontSize: "15px", fontWeight: 700, margin: 0, color: "#0f172a" }}>
                  Write Response
                </h3>

                <Form method="post">
                  <input type="hidden" name="intent" value="generate-ai" />
                  <button
                    type="submit"
                    style={{
                      padding: "8px 14px",
                      fontSize: "13px",
                      fontWeight: 600,
                      backgroundColor: "#f1f5f9",
                      color: "#0f172a",
                      border: "1px solid #cbd5e1",
                      borderRadius: "8px",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    ✨ Generate AI Draft
                  </button>
                </Form>
              </div>

              <Form method="post" key={replyFormKey}>
                <div style={{ marginBottom: "16px" }}>
                  <label
                    htmlFor="message"
                    style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}
                  >
                    Reply to Customer (will be sent via email)
                  </label>
                  <textarea
                    id="message"
                    name="message"
                    rows={4}
                    placeholder="Type your response here..."
                    style={{
                      width: "100%",
                      padding: "12px",
                      fontSize: "14px",
                      border: "1px solid #cbd5e1",
                      borderRadius: "8px",
                      boxSizing: "border-box",
                      outline: "none",
                      fontFamily: "inherit",
                    }}
                  />
                </div>

                {ticket.canManageInternalNotes ? (
                  <div style={{ marginBottom: "16px" }}>
                    <label
                      htmlFor="internalNote"
                      style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#92400e", marginBottom: "6px" }}
                    >
                      🔒 Internal Note (Only visible to support team)
                    </label>
                    <textarea
                      id="internalNote"
                      name="internalNote"
                      rows={2}
                      placeholder="Add private note for colleagues..."
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        fontSize: "13px",
                        border: "1px solid #fde68a",
                        backgroundColor: "#fffdf5",
                        borderRadius: "8px",
                        boxSizing: "border-box",
                        outline: "none",
                        fontFamily: "inherit",
                      }}
                    />
                  </div>
                ) : null}

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="submit"
                    style={{
                      padding: "10px 24px",
                      fontSize: "14px",
                      fontWeight: 600,
                      backgroundColor: "#0f172a",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "8px",
                      cursor: "pointer",
                    }}
                  >
                    Send Reply / Save Changes
                  </button>
                </div>
              </Form>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div
              style={{
                backgroundColor: "#ffffff",
                padding: "20px",
                borderRadius: "12px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
              }}
            >
              <h3 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 16px 0", color: "#0f172a" }}>
                Ticket Properties
              </h3>

              <Form method="post">
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div>
                    <label htmlFor="status" style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#64748b", marginBottom: "4px" }}>
                      Status
                    </label>
                    <select
                      id="status"
                      name="status"
                      defaultValue={ticket.status}
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        fontSize: "13px",
                        border: "1px solid #cbd5e1",
                        borderRadius: "6px",
                        backgroundColor: "#ffffff",
                      }}
                    >
                      {TICKET_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="assigneeId" style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#64748b", marginBottom: "4px" }}>
                      Assignee
                    </label>
                    <select
                      id="assigneeId"
                      name="assigneeId"
                      defaultValue={ticket.assignee?.id ?? ""}
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        fontSize: "13px",
                        border: "1px solid #cbd5e1",
                        borderRadius: "6px",
                        backgroundColor: "#ffffff",
                      }}
                    >
                      <option value="">Unassigned</option>
                      {ticket.agents.map((agent: { id: string; name: string; roleName: string }) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name} ({agent.roleName})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="priority" style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#64748b", marginBottom: "4px" }}>
                      Priority
                    </label>
                    <select
                      id="priority"
                      name="priority"
                      defaultValue={ticket.priority}
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        fontSize: "13px",
                        border: "1px solid #cbd5e1",
                        borderRadius: "6px",
                        backgroundColor: "#ffffff",
                      }}
                    >
                      {["LOW", "NORMAL", "HIGH", "URGENT"].map((priority) => (
                        <option key={priority} value={priority}>
                          {priority}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={isSavingProperties}
                    style={{
                      marginTop: "4px",
                      padding: "8px 14px",
                      fontSize: "13px",
                      fontWeight: 600,
                      backgroundColor: "#475569",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "6px",
                      cursor: isSavingProperties ? "wait" : "pointer",
                      opacity: isSavingProperties ? 0.7 : 1,
                    }}
                  >
                    {isSavingProperties ? "Saving…" : "Update Properties"}
                  </button>
                </div>
              </Form>
            </div>

            {ticket.shopifyCustomer ? (
              <div
                style={{
                  backgroundColor: "#ffffff",
                  padding: "20px",
                  borderRadius: "12px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "12px" }}>
                  <span style={{ fontSize: "16px" }}>🛍️</span>
                  <h3 style={{ fontSize: "15px", fontWeight: 700, margin: 0, color: "#0f172a" }}>
                    Shopify Customer
                  </h3>
                </div>

                <div style={{ fontSize: "14px", fontWeight: 600, color: "#0f172a" }}>
                  {[ticket.shopifyCustomer.firstName, ticket.shopifyCustomer.lastName].filter(Boolean).join(" ") ||
                    ticket.shopifyCustomer.email}
                  {ticket.shopifyCustomer.verifiedEmail ? " ✓" : ""}
                </div>

                <div style={{ fontSize: "13px", color: "#64748b", marginTop: "4px" }}>
                  {ticket.shopifyCustomer.email}
                </div>

                <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid #f1f5f9", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <div>
                    <div style={{ fontSize: "11px", color: "#94a3b8", fontWeight: 600 }}>TOTAL ORDERS</div>
                    <div style={{ fontSize: "15px", fontWeight: 700, color: "#0f172a" }}>{ticket.shopifyCustomer.ordersCount}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "11px", color: "#94a3b8", fontWeight: 600 }}>TOTAL SPENT</div>
                    <div style={{ fontSize: "15px", fontWeight: 700, color: "#059669" }}>{ticket.shopifyCustomer.totalSpent}</div>
                  </div>
                </div>

                {ticket.shopifyCustomer.tags.length > 0 ? (
                  <div style={{ marginTop: "10px", display: "flex", gap: "4px", flexWrap: "wrap" }}>
                    {ticket.shopifyCustomer.tags.map((tag, i) => (
                      <span key={i} style={{ fontSize: "11px", padding: "2px 8px", backgroundColor: "#f1f5f9", borderRadius: "4px", color: "#475569" }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div style={{ backgroundColor: "#ffffff", padding: "16px", borderRadius: "12px", fontSize: "13px", color: "#64748b" }}>
                No direct Shopify customer record matched for {ticket.customerEmail}
              </div>
            )}

            {ticket.shopifyOrders.length > 0 ? (
              <div
                style={{
                  backgroundColor: "#ffffff",
                  padding: "20px",
                  borderRadius: "12px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                }}
              >
                <h3 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 12px 0", color: "#0f172a" }}>
                  Recent Orders ({ticket.shopifyOrders.length})
                </h3>

                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {ticket.shopifyOrders.map((order) => (
                    <div
                      key={order.id}
                      style={{
                        padding: "12px",
                        borderRadius: "8px",
                        backgroundColor: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        fontSize: "13px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, color: "#0f172a", marginBottom: "4px" }}>
                        <span>{order.name}</span>
                        <span style={{ color: "#059669" }}>{order.totalPrice} {order.currency}</span>
                      </div>
                      <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "6px" }}>
                        {order.financialStatus} · {order.fulfillmentStatus ?? "Unfulfilled"}
                      </div>
                      {order.lineItems.length > 0 ? (
                        <div style={{ fontSize: "12px", color: "#334155" }}>
                          {order.lineItems.map((item, i) => (
                            <div key={i}>
                              {item.quantity}x {item.title}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {!order.cancelledAt && (
                        <Form method="post" style={{ marginTop: "8px" }}>
                          <input type="hidden" name="intent" value="propose-action" />
                          <input type="hidden" name="actionType" value="cancelOrder" />
                          <input type="hidden" name="actionInput" value={JSON.stringify({ orderName: order.name })} />
                          <button
                            type="submit"
                            style={{ padding: "4px 10px", fontSize: "11px", fontWeight: 600, color: "#dc2626", background: "#fff", border: "1px solid #fca5a5", borderRadius: 6, cursor: "pointer" }}
                          >
                            Propose: Cancel order
                          </button>
                        </Form>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div
              style={{
                backgroundColor: "#ffffff",
                padding: "20px",
                borderRadius: "12px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
              }}
            >
              <h3 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 8px 0", color: "#0f172a" }}>AI Actions</h3>
              <p style={{ fontSize: "12px", color: "#64748b", margin: "0 0 12px 0" }}>
                Propose any registered action (getOrder, refundOrder, createReturn, etc.). Write actions go through policy guardrails and, unless autopilot is enabled, require approval on the{" "}
                <Link to={ticket.actionsPath} style={{ color: "#2563eb" }}>Actions page</Link>.
              </p>
              <Form method="post">
                <input type="hidden" name="intent" value="propose-action" />
                <select name="actionType" style={{ width: "100%", padding: "8px 10px", fontSize: "13px", border: "1px solid #cbd5e1", borderRadius: "6px", marginBottom: "8px" }}>
                  {ticket.actionTypes.map((a) => (
                    <option key={a.type} value={a.type}>
                      {a.type} ({a.category})
                    </option>
                  ))}
                </select>
                <textarea
                  name="actionInput"
                  defaultValue={JSON.stringify({ orderName: "#1001" }, null, 2)}
                  rows={4}
                  style={{ width: "100%", padding: "8px 10px", fontSize: "12px", fontFamily: "monospace", border: "1px solid #cbd5e1", borderRadius: "6px", boxSizing: "border-box", marginBottom: "8px" }}
                />
                <button
                  type="submit"
                  style={{ padding: "8px 16px", background: "#0f172a", color: "#fff", border: "none", borderRadius: "6px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}
                >
                  Propose action
                </button>
              </Form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
