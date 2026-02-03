import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api.js";

interface MangaDetailProps {
  slug: string;
  onBack: () => void;
  initialVolume?: number;
  initialPage?: number;
}

export function MangaDetail({ slug, onBack, initialVolume, initialPage }: MangaDetailProps) {
  const mangaData = useQuery(api.manga.getMangaBySlug, { slug });
  const [selectedVolume, setSelectedVolume] = useState<number>(initialVolume || 1);

  useEffect(() => {
    if (mangaData?.volumes && mangaData.volumes.length > 0) {
      // If initialVolume is provided and exists in volumes, use it
      if (initialVolume) {
        const volumeExists = mangaData.volumes.some(v => v.volumeNumber === initialVolume);
        if (volumeExists) {
          setSelectedVolume(initialVolume);
          return;
        }
      }
      // Otherwise default to first volume
      setSelectedVolume(mangaData.volumes[0]!.volumeNumber);
    }
  }, [mangaData, initialVolume]);

  if (mangaData === undefined) {
    return <div>Loading...</div>;
  }

  if (!mangaData) {
    return <div>Manga not found</div>;
  }

  const { manga, volumes } = mangaData;

  return (
    <div>
      <a href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>
        ← Back to Library
      </a>

      <div style={{ marginBottom: "20px", border: "1px solid #ccc", padding: "10px" }}>
        <img
          src={manga.coverUrl}
          alt={manga.title}
          style={{ width: "150px", height: "auto" }}
        />
        <h1>{manga.title}</h1>
        <p>Status: {manga.status}</p>
        <p>Total Volumes: {manga.totalVolumes}</p>
        {manga.description && <p>{manga.description}</p>}
      </div>

      <div style={{ marginBottom: "20px" }}>
        <label htmlFor="volume-select">Select Volume: </label>
        <select
          id="volume-select"
          value={selectedVolume}
          onChange={(e) => setSelectedVolume(Number(e.target.value))}
          style={{ padding: "5px", fontSize: "16px" }}
        >
          {volumes.map((volume) => (
            <option key={volume._id} value={volume.volumeNumber}>
              Volume {volume.volumeNumber} {volume.chapterRange ? `(${volume.chapterRange})` : ""} - {volume.pageCount} pages
            </option>
          ))}
        </select>
      </div>

      <MangaReader slug={slug} volumeNumber={selectedVolume} mangaId={manga._id} initialPage={initialPage} />
    </div>
  );
}

interface MangaReaderProps {
  slug: string;
  volumeNumber: number;
  mangaId: string;
  initialPage?: number;
}

function MangaReader({ slug, volumeNumber, mangaId, initialPage }: MangaReaderProps) {
  const volumeData = useQuery(api.manga.getVolume, { mangaSlug: slug, volumeNumber });
  const [currentPage, setCurrentPage] = useState(initialPage ? initialPage - 1 : 0);
  const [inputPage, setInputPage] = useState<string>(initialPage ? String(initialPage) : "1");
  const preloadedRef = useRef<Set<number>>(new Set());
  const saveProgress = useMutation(api.readingProgress.saveProgress);

  // Update page when initialPage changes (for bookmarks)
  useEffect(() => {
    if (initialPage) {
      setCurrentPage(initialPage - 1);
      setInputPage(String(initialPage));
    }
  }, [initialPage]);

  // Track if this is the initial mount to avoid resetting bookmarked page
  const isInitialMount = useRef(true);
  
  // Reset page when volume changes (but not on initial mount)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    setCurrentPage(0);
    setInputPage("1");
    preloadedRef.current.clear();
  }, [volumeNumber]);

  // Update input when navigating pages
  useEffect(() => {
    setInputPage(String(currentPage + 1));
  }, [currentPage]);

  // Preload next page only
  useEffect(() => {
    if (!volumeData?.pages) return;

    const nextPage = currentPage + 1;
    if (nextPage < volumeData.pages.length && !preloadedRef.current.has(nextPage)) {
      const nextPageUrl = volumeData.pages[nextPage];
      if (nextPageUrl) {
        const img = new Image();
        img.src = nextPageUrl;
        preloadedRef.current.add(nextPage);
      }
    }
  }, [currentPage, volumeData]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!volumeData?.pages) return;

      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        goToPage(currentPage + 1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        goToPage(currentPage - 1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentPage, volumeData]);

  const goToPage = (pageIndex: number) => {
    if (!volumeData?.pages) return;
    if (pageIndex >= 0 && pageIndex < volumeData.pages.length) {
      setCurrentPage(pageIndex);
    }
  };

  if (volumeData === undefined) {
    return <div>Loading volume...</div>;
  }

  if (!volumeData) {
    return <div>Volume not found</div>;
  }

  const { manga, volume, pages } = volumeData;

  return (
    <div style={{ border: "2px solid #333", padding: "20px" }}>
      <h2>
        {manga.title} - Volume {volume.volumeNumber}
      </h2>
      {volume.chapterRange && <p>Chapters: {volume.chapterRange}</p>}

      {/* Navigation */}
      <div style={{ marginBottom: "20px" }}>
        {currentPage > 0 && (
          <a href="#" onClick={(e) => { e.preventDefault(); goToPage(currentPage - 1); }} style={{ marginRight: "10px" }}>
            ← Previous
          </a>
        )}
        <span>
          Page {currentPage + 1} of {volume.pageCount}
        </span>
        {currentPage < pages.length - 1 && (
          <a href="#" onClick={(e) => { e.preventDefault(); goToPage(currentPage + 1); }} style={{ marginLeft: "10px" }}>
            Next →
          </a>
        )}
        <span style={{ marginLeft: "20px" }}>
          Go to page: 
          <input
            type="number"
            min={1}
            max={volume.pageCount}
            value={inputPage}
            onChange={(e) => setInputPage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const targetPage = parseInt(inputPage, 10);
                if (targetPage >= 1 && targetPage <= volume.pageCount) {
                  goToPage(targetPage - 1);
                }
              }
            }}
            style={{ width: "60px", marginLeft: "5px" }}
          />
        </span>
      </div>

      {/* Image */}
      <div style={{
        textAlign: "center",
        marginBottom: "20px",
        minHeight: "500px",
        backgroundColor: "#f5f5f5"
      }}>
        <img
          src={pages[currentPage]}
          alt={`Page ${currentPage + 1}`}
          style={{
            maxWidth: "100%",
            height: "auto",
            border: "1px solid #ddd"
          }}
        />
      </div>

      <div style={{ marginTop: "20px", fontSize: "12px", color: "#999" }}>
        Tip: Use arrow keys (← →) or spacebar to navigate
      </div>

      {/* Bookmark Button */}
      <div style={{ marginTop: "30px", textAlign: "center" }}>
        <a 
          href="#" 
          onClick={async (e) => {
            e.preventDefault();
            try {
              await saveProgress({
                mangaId: mangaId as any,
                volumeNumber,
                pageNumber: currentPage + 1,
                pageUrl: pages[currentPage]!,
              });
              alert("✅ Bookmark saved!");
            } catch (err) {
              alert("❌ Please sign in to save bookmarks");
            }
          }}
        >
          🔖 Bookmark
        </a>
      </div>
    </div>
  );
}
