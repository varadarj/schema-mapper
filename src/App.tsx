import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { MappingPage } from "./pages/MappingPage";
import { ProviderPage } from "./pages/ProviderPage";
import { useMappingStore } from "./store/useMappingStore";
import { cn } from "@/lib/utils";

function NavBar() {
  const { mappings } = useMappingStore();
  const hasMappings = mappings.length > 0;

  return (
    <header className="border-b bg-background sticky top-0 z-50 bg-white">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="font-semibold text-sm">Schema Mapper</span>
          <nav className="flex items-center gap-1">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                cn(
                  "text-sm px-3 py-1.5 rounded-md transition-colors",
                  isActive
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )
              }
            >
              1 · Mapping
            </NavLink>
            <NavLink
              to="/provider"
              className={({ isActive }) =>
                cn(
                  "text-sm px-3 py-1.5 rounded-md transition-colors",
                  !hasMappings && "pointer-events-none opacity-40",
                  isActive
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )
              }
            >
              2 · Provider
            </NavLink>
          </nav>
        </div>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-background text-foreground">
        <NavBar />
        <main>
          <Routes>
            <Route path="/" element={<MappingPage />} />
            <Route path="/provider" element={<ProviderPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
