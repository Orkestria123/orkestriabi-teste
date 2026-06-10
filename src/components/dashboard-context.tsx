import { createContext, useContext } from "react";
import type { Company } from "@/hooks/use-financial-data";

export interface DashboardCtx {
  companyId: string | null;
  company: Company | null;
}

export const DashboardCompanyContext = createContext<DashboardCtx>({
  companyId: null,
  company: null,
});

export function useDashboardCompany() {
  return useContext(DashboardCompanyContext);
}
