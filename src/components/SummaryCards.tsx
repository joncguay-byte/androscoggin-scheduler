import React from "react";

const Card = ({children, className}:any)=> 
  <div className={className} style={{border:"1px solid #e2e8f0",borderRadius:16,background:"white"}}>
    {children}
  </div>;

const CardContent = ({children,className}:any)=> 
  <div className={className} style={{padding:16}}>
    {children}
  </div>;

export default function SummaryCards() {
  const cards = [
    { title: "CID On Call Today", value: "Troy Young" },
    { title: "Next Force Candidate", value: "Phillips" },
    { title: "Next Detail Candidate", value: "Miller" },
    { title: "Poland Coverage", value: "Covered" },
    { title: "Open Shift Count", value: "0" },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      {cards.map((card) => (
        <Card key={card.title} className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-5">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {card.title}
            </div>
            <div className="mt-3 text-2xl font-semibold text-slate-900">
              {card.value}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}