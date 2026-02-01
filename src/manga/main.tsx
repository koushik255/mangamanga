import { ConvexProvider, ConvexReactClient } from "convex/react";
import { createRoot } from "react-dom/client";
import { useState, useEffect } from "react";
import { MangaList } from "./MangaList";
import { MangaDetail } from "./MangaDetail";

// Configuration
const convexUrl = import.meta.env.VITE_CONVEX_URL;
const BACKEND_URL = "https://api.koushikkoushik.com";

// Backend connection check
async function checkBackendConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${BACKEND_URL}/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      // Short timeout to avoid waiting too long
      signal: AbortSignal.timeout(3000)
    });
    return response.ok;
  } catch (e) {
    return false;
  }
}

// Signal backend
async function signalBackend(): Promise<void> {
  try {
    const response = await fetch(`${BACKEND_URL}/signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        message: 'Frontend signal',
        timestamp: new Date().toISOString()
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Signal sent successfully:', data);
      alert('📡 Signal sent to backend! Check the server console.');
    } else {
      throw new Error('Backend returned error');
    }
  } catch (e) {
    console.error('❌ Failed to signal backend:', e);
    alert('❌ Failed to signal backend. Is the server running?');
  }
}

function App() {
  const [selectedManga, setSelectedManga] = useState<string | null>(null);
  const [backendAvailable, setBackendAvailable] = useState<boolean>(false);
  const [checkingBackend, setCheckingBackend] = useState<boolean>(true);

  // Check backend connection on mount
  useEffect(() => {
    checkBackendConnection().then(available => {
      setBackendAvailable(available);
      setCheckingBackend(false);
      if (available) {
        console.log('✅ Backend connected:', BACKEND_URL);
      } else {
        console.log('ℹ️ Backend not available (running in static mode)');
      }
    });
  }, []);

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
      <div style={{ position: 'relative', minHeight: '100vh' }}>
        {/* Backend Signal Button */}
        {!checkingBackend && backendAvailable && (
          <div style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: 1000,
          }}>
            <button
              onClick={signalBackend}
              style={{
                padding: '10px 20px',
                backgroundColor: '#4CAF50',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 'bold',
                boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#45a049';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#4CAF50';
              }}
            >
              📡 Signal Backend
            </button>
          </div>
        )}

        {/* Main Content */}
        {selectedManga ? (
          <MangaDetail 
            slug={selectedManga} 
            onBack={() => setSelectedManga(null)} 
          />
        ) : (
          <MangaList onSelectManga={setSelectedManga} />
        )}
      </div>
    </ConvexProvider>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
