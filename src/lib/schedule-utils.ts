const pitmanA = [0,1,1,0,0,1,1,1,0,0,1,1,0,0];
const patrolPositions = [
  { code: "SUP1", label: "Supervisor 1" },
  { code: "SUP2", label: "Supervisor 2" },
  { code: "DEP1", label: "Deputy 1" },
  { code: "DEP2", label: "Deputy 2" },
  { code: "POL", label: "Poland" },
];

export function getActiveTeam(date: Date, shiftType: ShiftType): Team {
  const dayOfMonth = date.getDate();
  const idx = (dayOfMonth - 1) % pitmanA.length;
  const aWorks = pitmanA[idx] === 1;
  if (shiftType === "Days") return aWorks ? "Days A" : "Days B";
  return aWorks ? "Nights A" : "Nights B";
}
function roleLabelForEmployee(employee: any, teamEmployees: any[]) {
  if (employee.rank === "Sgt") return "SUP1";
  if (employee.rank === "Cpl") return "SUP2";
  if (employee.rank === "Poland Deputy") return "POL";

  const deputies = teamEmployees
    .filter((e) => e.rank === "Deputy")
    .sort((a, b) => a.hireDate.localeCompare(b.hireDate));

  const index = deputies.findIndex((e) => e.id === employee.id);

  return index <= 0 ? "DEP1" : "DEP2";
}

export function buildPatrolCellsForDate(date: Date, employees: Employee[]): PatrolCellRecord[] {
  const cells: PatrolCellRecord[] = [];
  const dateKey = date.toISOString().slice(0, 10);

  (["Days", "Nights"] as ShiftType[]).forEach((shiftType) => {
    const team = getActiveTeam(date, shiftType);
    const teamEmployees = employees.filter((employee) => employee.team === team && employee.status === "Active");

    patrolPositions.forEach((position) => {
      const employee = teamEmployees.find((item) => roleLabelForEmployee(item, teamEmployees) === position.code) ?? null;
      cells.push({
        id: `${dateKey}-${shiftType}-${position.code}`,
        assignmentDate: dateKey,
        shiftType,
        team,
        positionCode: position.code,
        employeeId: employee?.id ?? null,
        vehicle: employee?.defaultVehicle ?? "",
        shiftHours: employee?.defaultShiftHours ?? (shiftType === "Days" ? "5a-5p" : "5p-5a"),
        status: employee ? "Scheduled" : "Open Shift",
        offReason: null,
        replacementEmployeeId: null,
        replacementVehicle: null,
        replacementHours: null,
        splitShift: null,
        notes: null,
      });
    });
  });

  return cells;
}
export function buildVisibleDates(baseDate: Date, view: ScheduleView) {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();

  // Month view should start Sunday before the 1st and end Saturday after last day
  if (view === "month") {
    const firstOfMonth = new Date(year, month, 1);
    const lastOfMonth = new Date(year, month + 1, 0);

    const start = new Date(firstOfMonth);
    start.setDate(firstOfMonth.getDate() - firstOfMonth.getDay()); // back to Sunday

    const end = new Date(lastOfMonth);
    end.setDate(lastOfMonth.getDate() + (6 - lastOfMonth.getDay())); // forward to Saturday

    const dates: Date[] = [];
    const current = new Date(start);

    while (current <= end) {
      dates.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }

    return dates;
  }

  // Two week view should also start Sunday
  if (view === "two_week") {
    const start = new Date(baseDate);
    start.setDate(baseDate.getDate() - baseDate.getDay());

    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }
 const count = countVisibleDates(baseDate, view);
  return Array.from({ length: count }, (_, i) => new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + i));
}

export function formatShortDate(date: Date) {
  return date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
}

export function formatLongDate(date: Date) {
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
export function validateShift(cells: PatrolCellRecord[], employees: Employee[]) {
  const warnings: string[] = [];
  const staffedCells = cells.filter((cell) => cell.status !== "Off" && cell.status !== "Open Shift" && cell.employeeId);
  const supervisors = staffedCells.filter((cell) => {
    const employee = employees.find((item) => item.id === cell.employeeId);
    return employee?.rank === "Sgt" || employee?.rank === "Cpl";
  }).length;
  const deputyLike = staffedCells.filter((cell) => {
    const employee = employees.find((item) => item.id === cell.employeeId);
    return employee?.rank === "Deputy" || employee?.rank === "Poland Deputy";
  }).length;
  const polandCovered = staffedCells.some((cell) => cell.positionCode === "POL");
  const staffingEquivalent = deputyLike + Math.max(0, supervisors - 1);

  if (supervisors < 1) warnings.push("Supervisor required");
  if (!polandCovered) warnings.push("Poland coverage missing");
  if (staffingEquivalent < 3) warnings.push("Minimum staffing not met");

  return warnings;
}
export function validateMinimumStaffing(cells:any[], schedule:any) {
  let supervisors = 0
  let deputies = 0
  let polandFilled = false

  cells.forEach((c) => {

const cell = schedule?.[c.id] ?? c
    if (!cell.employeeId) return

    if (cell.positionCode === "SUP1" || cell.positionCode === "SUP2") {
      supervisors++
    }

    if (cell.positionCode === "DEP1" || cell.positionCode === "DEP2") {
      deputies++
    }

    if (cell.positionCode === "POL") {
      polandFilled = true
    }
  })

  return {
    ok: supervisors >= 1 && deputies >= 2 && polandFilled,
    supervisors,
    deputies,
    polandFilled
  }
}






