import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DemoProvider, DEMO_COMPANY } from "@/lib/demo/context";
import { demoCompanies, demoPeriods } from "@/lib/demo/data";
import { DashboardCompanyContext } from "@/components/dashboard-context";
import { FilterProvider, FilterBar, useFilters } from "@/components/filter-bar";
import { VisaoGerencialProvider } from "@/hooks/use-visao-gerencial";
import { AppTopNav } from "@/components/app-topnav";
import { VisaoToggle } from "@/components/visao-toggle";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/demo")({ component: DemoLayout });
function DemoLayout() {
  return <DemoProvider><VisaoGerencialProvider><FilterProvider><DemoShell /></FilterProvider></VisaoGerencialProvider></DemoProvider>;
}
function DemoPeriods() {
  const {setAvailablePeriods,setAvailableYears,setYears,setMonths} = useFilters();
  useEffect(() => {
    setAvailablePeriods(demoPeriods);
    const years=[...new Set(demoPeriods.map((p)=>Number(p.slice(0,4))))];
    const last=demoPeriods[demoPeriods.length-1];
    setAvailableYears(years);
    if (!last) return;
    setYears([Number(last.slice(0,4))]);
    setMonths(demoPeriods.filter((p)=>p.slice(0,4)===last.slice(0,4)).map((p)=>Number(p.slice(5,7))));
  },[]);
  return null;
}
function DemoShell() {
  const [companyId,setCompanyId]=useState(DEMO_COMPANY);
  const company=demoCompanies.find((c)=>c.id===companyId) ?? demoCompanies[0];
  return <DashboardCompanyContext.Provider value={{companyId,company}}>
    <div className="flex min-h-screen w-full flex-col bg-background" data-tenant="open">
      <AppTopNav variant="client" title={company.name} actions={<><VisaoToggle /><Select value={companyId} onValueChange={setCompanyId}><SelectTrigger className="w-40 sm:w-52"><SelectValue /></SelectTrigger><SelectContent>{demoCompanies.map((c)=><SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></>} />
      <main className="flex-1"><DemoPeriods /><FilterBar /><div className="p-3 sm:p-4"><Outlet /></div></main>
    </div>
  </DashboardCompanyContext.Provider>;
}