import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { MappingPage } from "./pages/MappingPage";
import { ProviderPage } from "./pages/ProviderPage";
import { SourceTargetMappingPage } from "./pages/SourceTargetMappingPage";
import { SourceTargetExportPage } from "./pages/SourceTargetExportPage";

function NavBar() {
  const navigate = useNavigate();
  return (
    <header className="border-b bg-background sticky top-0 z-50 bg-white">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <button
          onClick={() => navigate("/")}
          className="font-semibold text-sm hover:opacity-70 transition-opacity"
        >
          Schema Mapper
        </button>
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
            <Route path="/" element={<HomePage />} />
            <Route path="/dsp3" element={<MappingPage />} />
            <Route path="/dsp3/provider" element={<ProviderPage />} />
            <Route path="/source-target" element={<SourceTargetMappingPage />} />
            <Route path="/source-target/export" element={<SourceTargetExportPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
