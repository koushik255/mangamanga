import { ConvexProvider, ConvexReactClient } from "convex/react";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { MangaList } from "./MangaList";
import { MangaDetail } from "./MangaDetail";

// Get Convex URL from environment variable (embedded at build time)
const convexUrl = import.meta.env.VITE_CONVEX_URL;

function App() {
  const [selectedManga, setSelectedManga] = useState<string | null>(null);

  if (!convexUrl) {
    return (
      <div style={{ color: "red", padding: "20px" }}>
        Error: Convex URL not configured. Please set VITE_CONVEX_URL environment variable.
      </div>
    );
  }

  const convex = new ConvexReactClient(convexUrl);

  return (
    <ConvexProvider client={convex}>
      {selectedManga ? (
        <MangaDetail 
          slug={selectedManga} 
          onBack={() => setSelectedManga(null)} 
        />
      ) : (
        <MangaList onSelectManga={setSelectedManga} />
      )}
    </ConvexProvider>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
