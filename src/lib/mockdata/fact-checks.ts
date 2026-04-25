import type { FactCheckFlag } from "@/lib/types";

// Demo session id ties mock flags to the demo transcript block on first load
// so the highlight design is visible without the backend pipeline running.
export const DEMO_SESSION_ID = "demo-session";

export function getMockFactCheckFlags(): FactCheckFlag[] {
  return [
    {
      type: "flag",
      sessionId: DEMO_SESSION_ID,
      sentence: "renewable capacity expanded across Europe",
      verdict: "true",
      reason:
        "EU renewable electricity generation has grown year-on-year; renewables surpassed fossil fuels in the EU electricity mix in 2024.",
      source: "https://ember-energy.org/latest-insights/european-electricity-review-2024/",
    },
    {
      type: "flag",
      sessionId: DEMO_SESSION_ID,
      sentence: "The EU produces 30% of global emissions",
      verdict: "disputed",
      reason:
        "Current data puts the EU share at around 7–8% of annual global greenhouse gas emissions.",
      source: "https://edgar.jrc.ec.europa.eu/report_2023",
    },
    {
      type: "flag",
      sessionId: DEMO_SESSION_ID,
      sentence: "Germany also gets almost all of its electricity from coal today.",
      verdict: "false",
      reason:
        "Coal remains part of Germany's electricity mix, but it is far from almost all generation.",
      source:
        "https://www.cleanenergywire.org/factsheets/germanys-energy-consumption-and-power-mix-charts",
    },
    {
      type: "flag",
      sessionId: DEMO_SESSION_ID,
      sentence:
        "Solar power became the cheapest electricity source in history according to global energy analysts.",
      verdict: "inconclusive",
      reason:
        "The IEA described solar PV as the cheapest source of electricity in history for projects with low-cost financing and strong resources — claim depends on conditions.",
      source: "https://www.iea.org/reports/world-energy-outlook-2020",
    },
  ];
}
