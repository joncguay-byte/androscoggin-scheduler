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
  <div className={className} style={{ border: "1px solid #e2e8f0", borderRadius: 16, background: "white" }}>
    {children}
  </div>
);

export const CardHeader = ({ children }: { children?: ReactNode }) => (
  <div style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0", fontWeight: 600 }}>
    {children}
  </div>
);

export const CardTitle = ({ children }: { children?: ReactNode }) => (
  <div style={{ fontSize: 16, fontWeight: 700 }}>{children}</div>
);

export const CardContent = ({ children, className }: CardProps) => (
  <div className={className} style={{ padding: 16 }}>{children}</div>
);

export const Button = ({ children, className, style, ...props }: ButtonProps) => (
  <button
    {...props}
    className={className}
    style={{
      padding: "6px 12px",
      border: "1px solid #cbd5e1",
      borderRadius: 8,
      background: "#f8fafc",
      cursor: "pointer",
      ...style
    }}
  >
    {children}
  </button>
);

export const Input = (props: InputProps) => (
  <input {...props} style={{ width: "100%", padding: 6, border: "1px solid #cbd5e1", borderRadius: 6 }} />
);

export const Label = ({ children }: { children?: ReactNode }) => (
  <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>{children}</div>
);

export function Select({ value, onValueChange, children }: SelectProps) {
  return (
    <select value={value} onChange={(e) => onValueChange?.(e.target.value)} style={{ padding: 6, border: "1px solid #cbd5e1", borderRadius: 6 }}>
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
