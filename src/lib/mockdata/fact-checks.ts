import type { FactCheckFlag } from "@/lib/types";

export function getMockFactCheckFlags(): FactCheckFlag[] {
  return [
    {
      type: "flag",
      sentence: "The EU produces 30% of global emissions.",
      verdict: "disputed",
      reason: "Current data puts the EU share at around 7–8% of annual global greenhouse gas emissions.",
      source: "https://edgar.jrc.ec.europa.eu/report_2023",
    },
    {
      type: "flag",
      sentence: "Germany also gets almost all of its electricity from coal today.",
      verdict: "false",
      reason: "Coal remains part of Germany's electricity mix, but it is far from almost all generation.",
      source: "https://www.cleanenergywire.org/factsheets/germanys-energy-consumption-and-power-mix-charts",
    },
    {
      type: "flag",
      sentence: "Solar power became the cheapest electricity source in history according to global energy analysts.",
      verdict: "needs-context",
      reason: "The IEA described solar PV as the cheapest source of electricity in history for projects with low-cost financing and strong resources.",
      source: "https://www.iea.org/reports/world-energy-outlook-2020",
    },
  ];
}
