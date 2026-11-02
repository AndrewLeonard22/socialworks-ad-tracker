import { createRoot } from "react-dom/client";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import DashboardPage from "@/app/page";
import CalendarPage from "@/app/calendar/page";
import ClientsPage from "@/app/clients/page";

/* Same pages as the Next.js app, mounted as one page for the claude.ai artifact */
function Router() {
  const path = usePathname();
  if (path === "/calendar") return <CalendarPage />;
  if (path === "/clients") return <ClientsPage />;
  return <DashboardPage />;
}

createRoot(document.getElementById("root")!).render(
  <AppShell>
    <Router />
  </AppShell>
);
