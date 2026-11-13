import { useState, type ReactNode } from "react";
import { LuCheck, LuX, LuPencil, LuUndo2, LuQuote, LuExternalLink, LuSparkles, LuCpu, LuMic, LuNotebookPen, LuListChecks, LuGitMerge, LuFlag } from "react-icons/lu";
import type { Chunk, Claim, Source } from "../../core/types";
import { escapeRegExp, formatDate, formatDateTime, formatSourceTime } from "../../core/text";
import { AccessBadge, Button, Drawer, StatusBadge, TypeTag, SourceIcon, cx } from "../ui";

export const ENGINE_LABEL: Record<Claim["engine"], { label: string; icon: typeof LuCpu }> = {
  ai: { label: "AI extraction", icon: LuSparkles },
  rules: { label: "Rules engine", icon: LuCpu },
  testimony: { label: "Leaver testimony", icon: LuMic },
  coverage: { label: "Coverage checklist", icon: LuListChecks },
  worklog: { label: "Work log", icon: LuNotebookPen },
};

const RED = /(\[REDACTED[^\]]*\])/g;
/** Show redaction markers as blacked-out bars; the marker text stays readable. */
export function Redacted({ text }: { text: string }) {
  const parts = text.split(RED);
  if (parts.length === 1) return <>{text}</>;
  return <>{parts.map((p, i) => (i % 2 ? <span key={i} className="redact" title="Removed before anything was stored">{p}</span> : p))}</>;
}

/** Split text around the quote so it can be highlighted without injecting HTML. */
export function Highlight({ text, quote }: { text: string; quote: string }) {
  let start = text.indexOf(quote), len = quote.length;
  if (start < 0) {
    const words = quote.split(/\s+/).filter(Boolean).map((w) => escapeRegExp(w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))).filter(Boolean);
    if (words.length) {
      const m = new RegExp(words.join("[\\s\\W]+"), "iu").exec(text);
      if (m) { start = m.index; len = m[0].length; }
    }
  }
  if (start < 0) return <Redacted text={text} />;
  return <><Redacted text={text.slice(0, start)} /><mark>{text.slice(start, start + len)}</mark><Redacted text={text.slice(start + len)} /></>;
}

export function EvidenceDrawer({ claim, chunks, sources, onClose, footer }: { claim: Claim | null; chunks: Map<string, Chunk>; sources: Map<string, Pick<Source, "id" | "name" | "kind" | "access">>; onClose: () => void; footer?: ReactNode }) {
  return (
    <Drawer open={!!claim} onClose={onClose} title="Evidence" subtitle={claim && <><StatusBadge status={claim.status} /> <TypeTag type={claim.type} /></>}>
      {claim && (
        <div className={cx("ev", `ev-st-${claim.status}`)}>
          <p className="ev-statement">{claim.statement}</p>
          <div className={cx("ev-reason", `ev-${claim.status}`)}>
            <strong>Why “{claim.status}”: </strong>{claim.statusReason}
          </div>
          {claim.evidence.length === 0 && (
            <div className="ev-none">
              <p><strong>No source supports this.</strong> Baton expected this information for a complete handover but did not find it in any source the successor is allowed to see.</p>
            </div>
          )}
          {claim.evidence.map((e, i) => {
            const ch = chunks.get(e.chunkId);
            const src = sources.get(e.sourceId);
            return (
              <div key={i} className={cx("ev-item", ch?.locator.question && "ev-testimony")}>
                <div className="ev-src">
                  {src && <SourceIcon kind={src.kind} />}
                  <div>
                    <div className="strong small">{src?.name || "Source"}</div>
                    <div className="muted xsmall">
                      {ch?.locator.url ? <a href={ch.locator.url} target="_blank" rel="noreferrer noopener">{ch.locator.label} <LuExternalLink aria-hidden /></a> : ch?.locator.label}
                      {ch?.author && !ch.locator.label.includes(ch.author) ? ` · ${ch.author}` : ""}
                      {ch?.time && !ch.locator.label.includes(formatSourceTime(ch.time).slice(0, 6)) ? ` · ${formatSourceTime(ch.time)}` : ""}
                    </div>
                  </div>
                  {src && <AccessBadge access={src.access} />}
                </div>
                {ch?.locator.question && <div className="ev-question">Question asked: {ch.locator.question}</div>}
                <div className="ev-match">
                  <LuQuote aria-hidden /> Quote {e.match === "exact" ? "found exactly" : e.match === "normalized" ? "found (spacing/punctuation normalised)" : "not found"}
                </div>
                {ch ? <pre className="ev-chunk"><Highlight text={ch.text} quote={e.quote} /></pre> : <pre className="ev-chunk muted">“{e.quote}” (source text not available in this view)</pre>}
              </div>
            );
          })}
          {claim.review.decision !== "pending" && (
            <div className="ev-review muted small">
              Review: <b>{claim.review.decision}</b>{claim.review.by ? ` by ${claim.review.by}` : ""}{claim.review.at ? ` · ${formatDateTime(claim.review.at)}` : ""}
              {claim.review.note ? <div>“{claim.review.note}”</div> : null}
              {claim.review.original ? <div>Original wording: “{claim.review.original}”</div> : null}
            </div>
          )}
          {footer}
        </div>
      )}
    </Drawer>
  );
}

export function ClaimCard({
  claim, chunks, sources, onEvidence, onDecide, reviewer, conflictPeers, flagged, extra,
}: {
  claim: Claim;
  chunks: Map<string, Chunk>;
  sources: Map<string, Pick<Source, "id" | "name" | "kind" | "access">>;
  onEvidence: (c: Claim) => void;
  onDecide?: (c: Claim, decision: "approved" | "rejected" | "pending" | "edited", patch?: { statement?: string; note?: string }) => void;
  reviewer?: string;
  conflictPeers?: Claim[];
  flagged?: { note: string; by: string; at: string }[];
  extra?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(claim.statement);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const E = ENGINE_LABEL[claim.engine];
  const d = claim.review.decision;

  return (
    <div className={cx("claim", `claim-${claim.status}`, d !== "pending" && `dec-${d}`, claim.resolvedBy && claim.status !== "verified" && "claim-resolved")}>
      <div className="claim-top">
        <StatusBadge status={claim.status} title={claim.statusReason} />
        <TypeTag type={claim.type} />
        {claim.date && <span className="chip chip-date">{formatDate(claim.date)}</span>}
        <span className="claim-engine" title={E.label}><E.icon aria-hidden /> {E.label}</span>
        {d !== "pending" && <span className={cx("dec-chip", `dec-chip-${d}`)}>{d === "approved" ? "Approved" : d === "edited" ? "Edited & approved" : "Rejected"}</span>}
      </div>
      {editing ? (
        <div className="claim-edit">
          <textarea className="textarea" rows={2} value={text} onChange={(e) => setText(e.target.value)} autoFocus aria-label="Edit statement" />
          <div className="row gap">
            <Button size="sm" variant="primary" disabled={!text.trim()} onClick={() => { onDecide?.(claim, "edited", { statement: text.trim() }); setEditing(false); }}>Save & approve</Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setText(claim.statement); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <p className="claim-text">{claim.statement}</p>
      )}
      <div className="claim-reason">{claim.statusReason}</div>
      {conflictPeers && conflictPeers.length > 0 && (
        <div className="claim-conflict"><LuGitMerge aria-hidden /> Conflicts with: {conflictPeers.map((p) => `“${p.statement}”`).join(" · ")}</div>
      )}
      {claim.resolvedBy && claim.review.note && <div className="claim-resolved-note">{claim.review.note}</div>}
      {flagged?.map((f, i) => <div key={i} className="claim-flag"><LuFlag aria-hidden /> Flagged by {f.by}: “{f.note}”</div>)}
      <div className="claim-foot">
        <div className="claim-evidence">
          {claim.evidence.length ? (
            claim.evidence.map((e, i) => {
              const ch = chunks.get(e.chunkId);
              const src = sources.get(e.sourceId);
              return (
                <button key={i} className="ev-chip" onClick={() => onEvidence(claim)} title="Show the exact evidence">
                  {src && <SourceIcon kind={src.kind} />}
                  <span>{ch?.locator.label || src?.name || "source"}</span>
                </button>
              );
            })
          ) : (
            <button className="ev-chip ev-chip-none" onClick={() => onEvidence(claim)}>No source found</button>
          )}
        </div>
        {onDecide && !editing && (
          <div className="claim-actions">
            {d === "pending" ? (
              <>
                <Button size="sm" variant="success" icon={<LuCheck />} onClick={() => onDecide(claim, "approved")} aria-label="Approve">Approve</Button>
                <Button size="sm" variant="ghost" icon={<LuPencil />} onClick={() => setEditing(true)} aria-label="Edit">Edit</Button>
                <Button size="sm" variant="ghost" icon={<LuX />} onClick={() => setRejecting(true)} aria-label="Reject">Reject</Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" icon={<LuUndo2 />} onClick={() => onDecide(claim, "pending")}>Undo</Button>
            )}
          </div>
        )}
        {extra}
      </div>
      {rejecting && (
        <div className="claim-edit">
          <input className="input" placeholder="Why reject? (optional, kept in the audit log)" value={note} onChange={(e) => setNote(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === "Enter") { onDecide?.(claim, "rejected", { note }); setRejecting(false); } }} />
          <div className="row gap">
            <Button size="sm" variant="danger" onClick={() => { onDecide?.(claim, "rejected", { note }); setRejecting(false); }}>Reject</Button>
            <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
          </div>
        </div>
      )}
      {reviewer && null}
    </div>
  );
}
