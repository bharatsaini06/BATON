// UI primitives.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes } from "react";
import { LuX, LuCircleCheck, LuTriangleAlert, LuCircleAlert, LuInfo, LuLoaderCircle, LuGithub, LuFileText, LuMessagesSquare, LuListChecks, LuNotebookPen, LuMic } from "react-icons/lu";
import type { AccessTag, EvidenceStatus, SourceKind, ClaimType } from "../core/types";
import { ACCESS_LABEL, STATUS_LABEL, CLAIM_TYPE_LABEL } from "../core/types";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" | "success" | "accent"; size?: "sm" | "md" | "lg"; loading?: boolean; icon?: ReactNode };
export function Button({ variant = "secondary", size = "md", loading, icon, children, className, disabled, ...rest }: BtnProps) {
  return (
    <button {...rest} disabled={disabled || loading} className={cx("btn", `btn-${variant}`, `btn-${size}`, className)}>
      {loading ? <LuLoaderCircle className="spin" aria-hidden /> : icon}
      {children && <span>{children}</span>}
    </button>
  );
}

export function Card({ children, className, pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <div className={cx("card", pad && "card-pad", className)}>{children}</div>;
}

export function StatusBadge({ status, title }: { status: EvidenceStatus; title?: string }) {
  return <span className={cx("badge", `st-${status}`)} title={title}>{STATUS_LABEL[status]}</span>;
}

export function AccessBadge({ access }: { access: AccessTag }) {
  return <span className={cx("badge", "acc", `acc-${access}`)} title={access === "private" ? "Never shared and never sent to the AI" : access === "lead" ? "Visible only to a successor with the Lead role" : "Visible to any successor"}>{ACCESS_LABEL[access]}</span>;
}

export function TypeTag({ type }: { type: ClaimType }) {
  return <span className={cx("type-tag", `ty-${type}`)}>{CLAIM_TYPE_LABEL[type]}</span>;
}

export function SourceIcon({ kind, className }: { kind: SourceKind; className?: string }) {
  const I = kind === "github" ? LuGithub : kind === "chat" ? LuMessagesSquare : kind === "tasks" ? LuListChecks : kind === "worklog" ? LuNotebookPen : kind === "testimony" ? LuMic : LuFileText;
  return <I className={cx("src-icon", `src-${kind}`, className)} aria-hidden />;
}

export function Spinner({ label }: { label?: string }) {
  return <span className="spinner-wrap"><LuLoaderCircle className="spin" aria-hidden /> {label}</span>;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function Callout({ tone = "info", title, children, action }: { tone?: "info" | "warn" | "danger" | "success"; title?: string; children?: ReactNode; action?: ReactNode }) {
  const I = tone === "success" ? LuCircleCheck : tone === "warn" ? LuTriangleAlert : tone === "danger" ? LuCircleAlert : LuInfo;
  return (
    <div className={cx("callout", `callout-${tone}`)} role={tone === "danger" ? "alert" : undefined}>
      <I className="callout-icon" aria-hidden />
      <div className="callout-body">
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
      {action && <div className="callout-action">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx("modal", wide && "modal-wide")} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><LuX /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children, subtitle }: { open: boolean; onClose: () => void; title: string; subtitle?: ReactNode; children: ReactNode }) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="overlay overlay-drawer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <div className="drawer-sub">{subtitle}</div>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><LuX /></button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} disabled={o.disabled} title={o.title} className={cx(value === o.value && "on")} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function AccessSelect({ value, onChange, id, compact }: { value: AccessTag; onChange: (v: AccessTag) => void; id?: string; compact?: boolean }) {
  return (
    <select id={id} className={cx("select", compact && "select-sm")} value={value} onChange={(e) => onChange(e.target.value as AccessTag)} aria-label="Who may see this source">
      <option value="member">Member — any successor</option>
      <option value="lead">Lead only</option>
      <option value="private">Private — never shared</option>
    </select>
  );
}

export function Meter({ value, label, size = 72 }: { value: number; label?: string; size?: number }) {
  const r = (size - 8) / 2, c = 2 * Math.PI * r;
  const tone = value >= 85 ? "var(--green)" : value >= 60 ? "var(--amber)" : value >= 30 ? "var(--yellow)" : "var(--red)";
  return (
    <div className="meter" style={{ width: size, height: size }} aria-label={`${label || "Score"} ${value} of 100`} role="img">
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--line)" strokeWidth="7" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={tone} strokeWidth="7" fill="none" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="meter-val">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------- toasts

type Toast = { id: number; tone: "success" | "danger" | "info"; text: string };
const ToastCtx = createContext<(tone: Toast["tone"], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const n = useRef(0);
  const push = useCallback((tone: Toast["tone"], text: string) => {
    const id = ++n.current;
    setList((l) => [...l, { id, tone, text }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), tone === "danger" ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={cx("toast", `toast-${t.tone}`)}>
            {t.tone === "success" ? <LuCircleCheck /> : t.tone === "danger" ? <LuCircleAlert /> : <LuInfo />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function copyText(text: string): Promise<boolean> {
  return navigator.clipboard?.writeText(text).then(() => true, () => false) ?? Promise.resolve(false);
}
