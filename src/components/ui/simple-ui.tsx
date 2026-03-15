import React from "react";

export const Card = ({ children, className }: any) => (
  <div className={className} style={{ border: "1px solid #e2e8f0", borderRadius: 16, background: "white" }}>
    {children}
  </div>
);

export const CardHeader = ({ children }: any) => (
  <div style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0", fontWeight: 600 }}>
    {children}
  </div>
);

export const CardTitle = ({ children }: any) => (
  <div style={{ fontSize: 16, fontWeight: 700 }}>{children}</div>
);

export const CardContent = ({ children, className }: any) => (
  <div className={className} style={{ padding: 16 }}>{children}</div>
);

export const Button = ({ children, onClick, className }: any) => (
  <button
    onClick={onClick}
    className={className}
    style={{
      padding: "6px 12px",
      border: "1px solid #cbd5e1",
      borderRadius: 8,
      background: "#f8fafc",
      cursor: "pointer",
    }}
  >
    {children}
  </button>
);

export const Input = (props: any) => (
  <input {...props} style={{ width: "100%", padding: 6, border: "1px solid #cbd5e1", borderRadius: 6 }} />
);

export const Label = ({ children }: any) => (
  <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>{children}</div>
);

export function Select({ value, onValueChange, children }: any) {
  return (
    <select value={value} onChange={(e) => onValueChange?.(e.target.value)} style={{ padding: 6, border: "1px solid #cbd5e1", borderRadius: 6 }}>
      {children}
    </select>
  );
}

export function SelectTrigger({ children }: any) {
  return <>{children}</>;
}

export function SelectValue() {
  return null;
}

export function SelectContent({ children }: any) {
  return <>{children}</>;
}

export function SelectItem({ value, children }: any) {
  return <option value={value}>{children}</option>;
}

export function Dialog({ open, children }: any) {
  if (!open) return null;
  return <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)" }}>{children}</div>;
}

export function DialogContent({ children }: any) {
  return <div style={{ background: "white", padding: 20, maxWidth: 420, margin: "10% auto", borderRadius: 10 }}>{children}</div>;
}

export function DialogHeader({ children }: any) {
  return <div>{children}</div>;
}

export function DialogTitle({ children }: any) {
  return <div style={{ fontWeight: 700, fontSize: 16 }}>{children}</div>;
}

export function DialogFooter({ children }: any) {
  return <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "flex-end" }}>{children}</div>;
}