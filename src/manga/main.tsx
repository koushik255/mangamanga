import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import { ConvexReactClient } from "convex/react";
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
    <ConvexAuthProvider client={convex}>
      <div style={{ position: 'relative', minHeight: '100vh' }}>
        {/* Authentication Buttons */}
        <AuthButtons />
        
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
    </ConvexAuthProvider>
  );
}

// Authentication Components
function AuthButtons() {
  const { signIn, signOut } = useAuthActions();
  
  return (
    <div style={{
      position: 'fixed',
      top: '20px',
      left: '20px',
      zIndex: 1001,
      display: 'flex',
      gap: '10px',
      alignItems: 'center',
    }}>
      <AuthLoading>
        <div style={{ color: '#666', fontSize: '14px' }}>Loading...</div>
      </AuthLoading>
      
      <Unauthenticated>
        <button
          onClick={() => void signIn("github")}
          style={{
            padding: '10px 20px',
            backgroundColor: '#24292e',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
          Sign in with GitHub
        </button>
      </Unauthenticated>
      
      <Authenticated>
        <button
          onClick={() => void signOut()}
          style={{
            padding: '10px 20px',
            backgroundColor: '#dc3545',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 'bold',
          }}
        >
          Sign out
        </button>
      </Authenticated>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
