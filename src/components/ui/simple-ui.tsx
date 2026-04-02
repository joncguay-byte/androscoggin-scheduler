import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode
} from "react";

type CardProps = {
  children?: ReactNode
  className?: string
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children?: ReactNode
}

type InputProps = InputHTMLAttributes<HTMLInputElement>

type SelectProps = {
  value?: string
  onValueChange?: (value: string) => void
  children?: ReactNode
}

type OptionProps = {
  value: string
  children?: ReactNode
}

export const Card = ({ children, className }: CardProps) => (
  <div
    className={className}
    style={{
      border: "1px solid #e2e8f0",
      borderRadius: 18,
      background: "linear-gradient(180deg, #ffffff 0%, #fcfdff 100%)",
      boxShadow: "0 12px 28px rgba(15, 23, 42, 0.05)",
      overflow: "hidden"
    }}
  >
    {children}
  </div>
);

export const CardHeader = ({ children }: { children?: ReactNode }) => (
  <div
    style={{
      padding: "14px 18px",
      borderBottom: "1px solid #e2e8f0",
      fontWeight: 600,
      background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)"
    }}
  >
    {children}
  </div>
);

export const CardTitle = ({ children }: { children?: ReactNode }) => (
  <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.01em", color: "#0f172a" }}>{children}</div>
);

export const CardContent = ({ children, className }: CardProps) => (
  <div className={className} style={{ padding: 18 }}>{children}</div>
);

export const Button = ({ children, className, style, ...props }: ButtonProps) => (
  <button
    {...props}
    className={className}
    style={{
      padding: "8px 14px",
      border: "1px solid #cbd5e1",
      borderRadius: 10,
      background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
      color: "#0f172a",
      cursor: "pointer",
      fontWeight: 700,
      boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
      transition: "transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease, background 140ms ease, color 140ms ease",
      ...style
    }}
  >
    {children}
  </button>
);

export const Input = (props: InputProps) => (
  <input
    {...props}
    style={{
      width: "100%",
      padding: "8px 10px",
      border: "1px solid #cbd5e1",
      borderRadius: 10,
      background: "#ffffff",
      boxSizing: "border-box",
      color: "#0f172a"
    }}
  />
);

export const Label = ({ children }: { children?: ReactNode }) => (
  <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>{children}</div>
);

export function Select({ value, onValueChange, children }: SelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onValueChange?.(e.target.value)}
      style={{
        padding: "8px 10px",
        border: "1px solid #cbd5e1",
        borderRadius: 10,
        background: "#ffffff",
        color: "#0f172a"
      }}
    >
      {children}
    </select>
  );
}

export function SelectTrigger({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

export function SelectValue() {
  return null;
}

export function SelectContent({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

export function SelectItem({ value, children }: OptionProps) {
  return <option value={value}>{children}</option>;
}

export function Dialog({ open, children }: { open: boolean, children?: ReactNode }) {
  if (!open) return null;
  return <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)" }}>{children}</div>;
}

export function DialogContent({ children }: { children?: ReactNode }) {
  return <div style={{ background: "white", padding: 20, maxWidth: 420, margin: "10% auto", borderRadius: 10 }}>{children}</div>;
}

export function DialogHeader({ children }: { children?: ReactNode }) {
  return <div>{children}</div>;
}

export function DialogTitle({ children }: { children?: ReactNode }) {
  return <div style={{ fontWeight: 700, fontSize: 16 }}>{children}</div>;
}

export function DialogFooter({ children }: { children?: ReactNode }) {
  return <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "flex-end" }}>{children}</div>;
}
