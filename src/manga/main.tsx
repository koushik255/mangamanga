import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
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
  const [selectedManga, setSelectedManga] = useState<{ slug: string; volume?: number; page?: number } | null>(null);
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
            top: '80px',
            right: '20px',
            zIndex: 1000,
          }}>
            <a href="#" onClick={(e) => { e.preventDefault(); signalBackend(); }}>
              📡 Signal Backend
            </a>
          </div>
        )}

        {/* Main Content */}
        {selectedManga ? (
          <MangaDetail 
            slug={selectedManga.slug} 
            initialVolume={selectedManga.volume}
            initialPage={selectedManga.page}
            onBack={() => setSelectedManga(null)} 
          />
        ) : (
          <MangaList onSelectManga={(slug, volume, page) => setSelectedManga({ slug, volume, page })} />
        )}
      </div>
    </ConvexAuthProvider>
  );
}

// Authentication Components
function AuthButtons() {
  const { signIn, signOut } = useAuthActions();
  const user = useQuery(api.users.getCurrentUser);
  
  return (
    <div style={{
      position: 'fixed',
      top: '20px',
      right: '120px',
      zIndex: 1001,
      display: 'flex',
      gap: '10px',
      alignItems: 'center',
    }}>
      <AuthLoading>
        <div style={{ color: '#666', fontSize: '14px' }}>Loading...</div>
      </AuthLoading>
      
      <Unauthenticated>
        <a href="#" onClick={(e) => { e.preventDefault(); void signIn("github", { redirectTo: "/manga" }); }}>
          Sign in with GitHub
        </a>
      </Unauthenticated>
      
      <Authenticated>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <a href="#" onClick={(e) => { e.preventDefault(); void signOut(); }}>
            Sign out
          </a>
          {user?.image && (
            <img
              src={user.image}
              alt={user.name || 'User'}
              title={user.name || 'User'}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                border: '2px solid #fff',
                boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
                objectFit: 'cover',
              }}
            />
          )}
        </div>
      </Authenticated>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
