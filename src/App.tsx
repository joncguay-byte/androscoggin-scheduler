import React, { useMemo, useState } from "react";
import Header from "./components/Header";
import SummaryCards from "./components/SummaryCards";
import ModuleTabs from "./components/ModuleTabs";
import { PatrolPage } from "./modules/patrol/PatrolPage";
import EmployeesPage from "./modules/employees/EmployeesPage";
import { ForcePage } from "./modules/force/ForcePage";
import {
  Shield,
  Users,
  CalendarDays,
  FileText,
  Settings,
  Briefcase,
  Clock3,
  Search,
  Plus,
  RefreshCw,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Edit3,
} from "lucide-react";
// Simple built-in UI components (to avoid external dependency setup)
export const Card = ({children, className}:any)=> <div className={className} style={{border:"1px solid #e2e8f0",borderRadius:16,background:"white"}}>{children}</div>;
export const CardHeader = ({children}:any)=> <div style={{padding:"12px 16px",borderBottom:"1px solid #e2e8f0",fontWeight:600}}>{children}</div>;
export const CardTitle = ({children}:any)=> <div style={{fontSize:16,fontWeight:700}}>{children}</div>;
export const CardContent = ({children,className}:any)=> <div className={className} style={{padding:16}}>{children}</div>;

export const Button = ({children,onClick,className}:any)=> (
  <button onClick={onClick} className={className} style={{padding:"6px 12px",border:"1px solid #cbd5e1",borderRadius:8,background:"#f8fafc",cursor:"pointer"}}>{children}</button>
);

export const Input = (props:any)=> <input {...props} style={{width:"100%",padding:6,border:"1px solid #cbd5e1",borderRadius:6}}/>;

export const Label = ({children}:any)=> <div style={{fontWeight:600,fontSize:12,marginBottom:4}}>{children}</div>;

export function Select({value,onValueChange,children}:any){
  return <select value={value} onChange={(e)=>onValueChange?.(e.target.value)} style={{padding:6,border:"1px solid #cbd5e1",borderRadius:6}}>{children}</select>;
}
export function SelectTrigger({children}:any){return <>{children}</>}
export function SelectValue(){return null}
export function SelectContent({children}:any){return <>{children}</>}
export function SelectItem({value,children}:any){return <option value={value}>{children}</option>}

export const Badge = ({children}:any)=> <span style={{padding:"2px 6px",border:"1px solid #cbd5e1",borderRadius:6,fontSize:12}}>{children}</span>;

export const Tabs = ({children}:any)=> <div>{children}</div>;
export const TabsList = ({children}:any)=> <div style={{display:"flex",gap:6}}>{children}</div>;
export const TabsTrigger = ({children}:any)=> <button>{children}</button>;

export const Switch = (props:any)=> <input type="checkbox" {...props}/>;

export const Separator = ()=> <hr style={{margin:"10px 0"}}/>;

export function Dialog({open,children}:any){ if(!open) return null; return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.3)"}}>{children}</div>; }
export function DialogContent({children}:any){ return <div style={{background:"white",padding:20,maxWidth:420,margin:"10% auto",borderRadius:10}}>{children}</div>; }
export function DialogHeader({children}:any){return <div>{children}</div>}
export function DialogTitle({children}:any){return <div style={{fontWeight:700,fontSize:16}}>{children}</div>}
export function DialogFooter({children}:any){return <div style={{marginTop:12,display:"flex",gap:8,justifyContent:"flex-end"}}>{children}</div>}

export const ScrollArea = ({children}:any)=> <div style={{maxHeight:400,overflow:"auto"}}>{children}</div>;

type AppRole = "Admin" | "Sergeant" | "Detective" | "Deputy";
type Rank = "Sgt" | "Cpl" | "Deputy" | "Poland Deputy" | "Detective";
type Team = "Days A" | "Days B" | "Nights A" | "Nights B" | "CID" | "SRO" | "None";
type EmployeeStatus = "Active" | "Inactive";
type ScheduleView = "month" | "two_week" | "week" | "day";
type ModuleKey = "patrol" | "cid" | "force" | "detail" | "reports" | "employees" | "settings";
type ShiftType = "Days" | "Nights";
type PatrolPositionCode = "SUP1" | "SUP2" | "DEP1" | "DEP2" | "POL";
type PatrolStatus =
  | "Scheduled"
  | "Sick"
  | "Vacation"
  | "Court"
  | "Training"
  | "FMLA"
  | "Professional Leave"
  | "Bereavement"
  | "Call Out"
  | "Detail"
  | "Extra"
  | "Swap"
  | "Open Shift"
  | "Off";

type Employee = {
  id: string;
  firstName: string;
  lastName: string;
  rank: Rank;
  team: Team;
  defaultVehicle: string;
  defaultShiftHours: string;
  hireDate: string;
  status: EmployeeStatus;
};

type UserProfile = {
  id: string;
  username: string;
  role: AppRole;
  defaultView: ScheduleView;
};

type PermissionMap = Record<AppRole, Record<ModuleKey, { view: boolean; edit: boolean }>>;

type PatrolCellRecord = {
  id: string;
  assignmentDate: string;
  shiftType: ShiftType;
  team: Team;
  positionCode: PatrolPositionCode;
  employeeId: string | null;
  vehicle: string | null;
  shiftHours: string | null;
  status: PatrolStatus;
  offReason: string | null;
  replacementEmployeeId: string | null;
  replacementVehicle: string | null;
  replacementHours: string | null;
  splitShift: string | null;
  notes: string | null;
};

type EditingCell = {
  cell: PatrolCellRecord;
  employeeId: string;
  vehicle: string;
  shiftHours: string;
  status: PatrolStatus;
  offReason: string;
  replacementEmployeeId: string;
  replacementVehicle: string;
  replacementHours: string;
  splitShift: string;
  notes: string;
};

const teamOptions: Team[] = ["Days A", "Days B", "Nights A", "Nights B", "CID", "SRO", "None"];
const rankOptions: Rank[] = ["Sgt", "Cpl", "Deputy", "Poland Deputy", "Detective"];
const employeeStatusOptions: EmployeeStatus[] = ["Active", "Inactive"];
export const scheduleViews: { value: ScheduleView; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "two_week", label: "2 Week" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
];
const roles: AppRole[] = ["Admin", "Sergeant", "Detective", "Deputy"];
const moduleOrder: { key: ModuleKey; label: string; icon: React.ComponentType<any> }[] = [
  { key: "patrol", label: "Patrol", icon: Shield },
  { key: "cid", label: "CID", icon: Clock3 },
  { key: "force", label: "Force", icon: AlertTriangle },
  { key: "detail", label: "Detail", icon: Briefcase },
  { key: "reports", label: "Reports", icon: FileText },
  { key: "employees", label: "Employees", icon: Users },
  { key: "settings", label: "Settings", icon: Settings },
];
const fixedColors = [
  "Slate",
  "Gray",
  "Blue",
  "Dark Blue",
  "Sky",
  "Indigo",
  "Purple",
  "Violet",
  "Pink",
  "Rose",
  "Red",
  "Orange",
  "Amber",
  "Yellow",
  "Lime",
  "Green",
  "Emerald",
  "Teal",
  "Cyan",
  "Black",
];
const vehicleOptions = Array.from({ length: 53 }, (_, i) => `V${i + 1}`);
export const patrolPositions: { code: PatrolPositionCode; label: string }[] = [
  { code: "SUP1", label: "Supervisor 1" },
  { code: "SUP2", label: "Supervisor 2" },
  { code: "DEP1", label: "Deputy 1" },
  { code: "DEP2", label: "Deputy 2" },
  { code: "POL", label: "Poland" },
];
export const statusOptions: PatrolStatus[] = [
  "Scheduled",
  "Sick",
  "Vacation",
  "Court",
  "Training",
  "FMLA",
  "Professional Leave",
  "Bereavement",
  "Call Out",
  "Detail",
  "Extra",
  "Swap",
  "Open Shift",
  "Off",
];
const pitmanA = [0, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0];

const initialEmployees: Employee[] = [
  { id: "1", firstName: "Jon", lastName: "Guay", rank: "Sgt", team: "Days A", defaultVehicle: "V7", defaultShiftHours: "5a-5p", hireDate: "2011-05-01", status: "Active" },
  { id: "2", firstName: "Dylan", lastName: "Rider", rank: "Cpl", team: "Days A", defaultVehicle: "V17", defaultShiftHours: "5a-5p", hireDate: "2013-06-01", status: "Active" },
  { id: "3", firstName: "Jimmy", lastName: "Phillips", rank: "Deputy", team: "Days A", defaultVehicle: "V13", defaultShiftHours: "5a-5p", hireDate: "2015-02-15", status: "Active" },
  { id: "4", firstName: "Chris", lastName: "Miller", rank: "Deputy", team: "Days A", defaultVehicle: "V25", defaultShiftHours: "5a-5p", hireDate: "2018-08-20", status: "Active" },
  { id: "5", firstName: "Joe", lastName: "Tripp", rank: "Poland Deputy", team: "Days A", defaultVehicle: "V28", defaultShiftHours: "5a-5p", hireDate: "2020-01-10", status: "Active" },
  { id: "6", firstName: "Brian", lastName: "Smith", rank: "Sgt", team: "Days B", defaultVehicle: "V6", defaultShiftHours: "5a-5p", hireDate: "2010-09-01", status: "Active" },
  { id: "7", firstName: "Dylan", lastName: "Morin", rank: "Cpl", team: "Days B", defaultVehicle: "V12", defaultShiftHours: "5a-5p", hireDate: "2014-11-14", status: "Active" },
  { id: "8", firstName: "Matt", lastName: "Noyes", rank: "Deputy", team: "Days B", defaultVehicle: "V14", defaultShiftHours: "5a-5p", hireDate: "2016-04-01", status: "Active" },
  { id: "9", firstName: "Emma", lastName: "Stone", rank: "Deputy", team: "Days B", defaultVehicle: "V10", defaultShiftHours: "5a-5p", hireDate: "2019-02-10", status: "Active" },
  { id: "10", firstName: "Lance", lastName: "Neal", rank: "Poland Deputy", team: "Days B", defaultVehicle: "V24", defaultShiftHours: "5a-5p", hireDate: "2022-03-05", status: "Active" },
  { id: "11", firstName: "Devon", lastName: "Bohacik", rank: "Sgt", team: "Nights A", defaultVehicle: "V30", defaultShiftHours: "5p-5a", hireDate: "2012-04-04", status: "Active" },
  { id: "12", firstName: "Greg", lastName: "Pealatere", rank: "Cpl", team: "Nights A", defaultVehicle: "V31", defaultShiftHours: "5p-5a", hireDate: "2014-03-01", status: "Active" },
  { id: "13", firstName: "Zach", lastName: "West", rank: "Deputy", team: "Nights A", defaultVehicle: "V29", defaultShiftHours: "5p-5a", hireDate: "2017-07-11", status: "Active" },
  { id: "14", firstName: "Maverick", lastName: "Real", rank: "Deputy", team: "Nights A", defaultVehicle: "V22", defaultShiftHours: "5p-5a", hireDate: "2021-06-01", status: "Active" },
  { id: "15", firstName: "Darryn", lastName: "Bailey", rank: "Poland Deputy", team: "Nights A", defaultVehicle: "V33", defaultShiftHours: "5p-5a", hireDate: "2022-01-15", status: "Active" },
  { id: "16", firstName: "Travis", lastName: "Lovering", rank: "Sgt", team: "Nights B", defaultVehicle: "V8", defaultShiftHours: "5p-5a", hireDate: "2011-01-01", status: "Active" },
  { id: "17", firstName: "Vic", lastName: "Barr", rank: "Cpl", team: "Nights B", defaultVehicle: "V19", defaultShiftHours: "5p-5a", hireDate: "2015-08-08", status: "Active" },
  { id: "18", firstName: "Mike", lastName: "Jones", rank: "Deputy", team: "Nights B", defaultVehicle: "V26", defaultShiftHours: "5p-5a", hireDate: "2018-05-22", status: "Active" },
  { id: "19", firstName: "Kurt", lastName: "Fegan", rank: "Deputy", team: "Nights B", defaultVehicle: "V32", defaultShiftHours: "5p-5a", hireDate: "2020-07-07", status: "Active" },
  { id: "20", firstName: "Darian", lastName: "Nadeau", rank: "Poland Deputy", team: "Nights B", defaultVehicle: "V21", defaultShiftHours: "5p-5a", hireDate: "2023-01-30", status: "Active" },
];

const initialPermissions: PermissionMap = {
  Admin: {
    patrol: { view: true, edit: true },
    cid: { view: true, edit: true },
    force: { view: true, edit: true },
    detail: { view: true, edit: true },
    reports: { view: true, edit: true },
    employees: { view: true, edit: true },
    settings: { view: true, edit: true },
  },
  Sergeant: {
    patrol: { view: true, edit: true },
    cid: { view: true, edit: true },
    force: { view: true, edit: true },
    detail: { view: true, edit: true },
    reports: { view: true, edit: false },
    employees: { view: true, edit: true },
    settings: { view: true, edit: false },
  },
  Detective: {
    patrol: { view: true, edit: false },
    cid: { view: true, edit: true },
    force: { view: true, edit: false },
    detail: { view: true, edit: false },
    reports: { view: true, edit: false },
    employees: { view: true, edit: false },
    settings: { view: false, edit: false },
  },
  Deputy: {
    patrol: { view: true, edit: false },
    cid: { view: true, edit: false },
    force: { view: true, edit: false },
    detail: { view: true, edit: false },
    reports: { view: true, edit: false },
    employees: { view: true, edit: false },
    settings: { view: false, edit: false },
  },
};

function sortBySeniority(employees: Employee[]) {
  return [...employees].sort((a, b) => {
    const aTime = a.hireDate ? new Date(a.hireDate).getTime() : Number.MAX_SAFE_INTEGER;
    const bTime = b.hireDate ? new Date(b.hireDate).getTime() : Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}


function roleLabelForEmployee(employee: Employee, teamEmployees: Employee[]) {
  if (employee.rank === "Sgt") return "SUP1" as PatrolPositionCode;
  if (employee.rank === "Cpl") return "SUP2" as PatrolPositionCode;
  if (employee.rank === "Poland Deputy") return "POL" as PatrolPositionCode;
  const deputies = teamEmployees.filter((item) => item.rank === "Deputy").sort((a, b) => a.hireDate.localeCompare(b.hireDate));
  const index = deputies.findIndex((item) => item.id === employee.id);
  return index <= 0 ? ("DEP1" as PatrolPositionCode) : ("DEP2" as PatrolPositionCode);
}


function countVisibleDates(baseDate: Date, view: ScheduleView) {
  if (view === "day") return 1;
  if (view === "week") return 7;
  if (view === "two_week") return 14;
  return new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0).getDate();
}

 



function getStatusBadgeClass(status: PatrolStatus, highlightYellow: boolean) {
  if (highlightYellow && (status === "Open Shift" || status === "Swap")) return "bg-yellow-200 text-yellow-900 border-yellow-300";
  switch (status) {
    case "Vacation":
      return "bg-amber-100 text-amber-900 border-amber-200";
    case "Sick":
    case "Call Out":
      return "bg-red-100 text-red-900 border-red-200";
    case "Training":
      return "bg-blue-100 text-blue-900 border-blue-200";
    case "Court":
      return "bg-purple-100 text-purple-900 border-purple-200";
    case "Detail":
      return "bg-green-100 text-green-900 border-green-200";
    case "Extra":
      return "bg-cyan-100 text-cyan-900 border-cyan-200";
    case "Open Shift":
      return "bg-yellow-200 text-yellow-900 border-yellow-300";
    case "Off":
      return "bg-slate-100 text-slate-700 border-slate-200";
    default:
      return "bg-white text-slate-900 border-slate-200";
  }
}


function EmptyModule({ title }: { title: string }) {
  return (
    <Card className="border-slate-200 shadow-sm rounded-2xl">
      <CardContent className="py-16 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
          <CalendarDays className="h-7 w-7 text-slate-500" />
        </div>
        <h3 className="text-xl font-semibold text-slate-900">{title} module scaffolded</h3>
        <p className="mt-2 text-sm text-slate-500">This screen is ready for the next build step.</p>
      </CardContent>
    </Card>
  );
}

// =============================
// SHARED COMPONENTS
// In a real project these would live in:
// components/Header.tsx, components/SummaryCards.tsx, components/ModuleTabs.tsx
// =============================


// =============================
// PATROL MODULE
// In a real project this would live in:
// modules/patrol/PatrolPage.tsx
// =============================

// =============================
// modules/patrol/PatrolPage.tsx
// (first module extracted for modular architecture)
// =============================

// =============================
// ROOT APPLICATION
// In a real project this would live in:
// App.tsx
// =============================

// =============================
// App.tsx (root application shell)
// =============================
export default function App() {
  const [user, setUser] = useState<UserProfile>({ id: "u1", username: "Admin User", role: "Admin", defaultView: "month" });
  const [employees, setEmployees] = useState<Employee[]>(initialEmployees);
  const [activeModule, setActiveModule] = useState<ModuleKey>("patrol");

  const permissions = initialPermissions[user.role];
  const visibleModules = moduleOrder.filter((m)=>permissions[m.key].view).map((m)=>m.key);
  const canEdit = permissions.patrol.edit;

  return (
  <div style={{width:"100%",minHeight:"100vh",padding:"20px",boxSizing:"border-box"}}>
      <Header user={user} onRoleChange={(r)=>setUser({...user, role:r})} />

      <div style={{marginTop:"20px",marginBottom:"20px"}}>
  <SummaryCards />
</div>

      <ModuleTabs
  active={activeModule}
  onChange={setActiveModule}
  visibleModules={visibleModules}
  moduleOrder={moduleOrder}
/>

      {activeModule === "patrol" && <PatrolPage employees={employees} canEdit={canEdit} />}
      {activeModule === "cid" && <EmptyModule title="CID" />}
      {activeModule === "force" && <EmptyModule title="Force" />}
      {activeModule === "detail" && <EmptyModule title="Detail" />}
      {activeModule === "reports" && <EmptyModule title="Reports" />}
      {activeModule === "employees" && (
  <EmployeesPage
    employees={employees}
    setEmployees={setEmployees}
  />
)}
      {activeModule === "settings" && <EmptyModule title="Settings" />}
    </div>
  );
}
