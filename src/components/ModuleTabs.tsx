import React from "react";

const Button = ({children,onClick,className}:any)=> (
  <button
    onClick={onClick}
    className={className}
    style={{
      padding:"6px 12px",
      border:"1px solid #cbd5e1",
      borderRadius:8,
      background:"#f8fafc",
      cursor:"pointer"
    }}
  >
    {children}
  </button>
);

export default function ModuleTabs({ active, onChange, visibleModules, moduleOrder }: any) {
  return (
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
      {moduleOrder
        .filter((m:any)=>visibleModules.includes(m.key))
        .map((m:any)=>{
          const Icon = m.icon;
          const isActive = active===m.key;

          return (
            <Button
              key={m.key}
              className={isActive ? "bg-slate-900 text-white" : ""}
              onClick={()=>onChange(m.key)}
            >
              <Icon style={{marginRight:6}} size={16}/>
              {m.label}
            </Button>
          );
        })}
    </div>
  );
}