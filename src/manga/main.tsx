import { ConvexProvider, ConvexReactClient } from "convex/react";
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { MangaList } from "./MangaList.js";
import { MangaDetail } from "./MangaDetail.js";

// Fetch config from server
async function fetchConfig(): Promise<{ convexUrl: string }> {
  const response = await fetch("/manga/config");
  return response.json();
}

function App() {
  const [convex, setConvex] = useState<ConvexReactClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedManga, setSelectedManga] = useState<string | null>(null);

  useEffect(() => {
    fetchConfig()
      .then((config) => {
        if (!config.convexUrl) {
          setError("Convex URL not configured");
          return;
        }
        setConvex(new ConvexReactClient(config.convexUrl));
      })
      .catch((err) => {
        setError("Failed to load configuration");
        console.error(err);
      });
  }, []);

  if (error) {
    return <div style={{ color: "red", padding: "20px" }}>Error: {error}</div>;
  }

  if (!convex) {
    return <div style={{ padding: "20px" }}>Loading...</div>;
  }

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
