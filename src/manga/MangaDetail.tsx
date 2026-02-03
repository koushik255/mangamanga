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

interface DoubleSpreadInfo {
  isDoubleSpread: boolean;
  imageUrl: string;
  coversPages: number[]; // Which logical pages this image covers
}

interface DoubleSpreadImageProps {
  pageInfo: DoubleSpreadInfo | undefined;
  fallbackUrl: string;
  pageNumber: number;
}

function DoubleSpreadImage({ pageInfo, fallbackUrl, pageNumber }: DoubleSpreadImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  const imageUrl = pageInfo?.imageUrl || fallbackUrl;

  return (
    <>
      {!isLoaded && !hasError && (
        <div style={{ padding: "20px", color: "#666" }}>
          Loading page {pageNumber}...
        </div>
      )}
      {hasError && (
        <div style={{ padding: "20px", color: "#ff0000" }}>
          Failed to load page {pageNumber}
        </div>
      )}
      <img
        src={imageUrl}
        alt={`Page ${pageNumber}${pageInfo?.isDoubleSpread ? " (Double Spread)" : ""}`}
        style={{
          maxWidth: "100%",
          height: "auto",
          border: "1px solid #ddd",
          display: isLoaded ? "block" : "none",
        }}
        onLoad={() => setIsLoaded(true)}
        onError={() => {
          setIsLoaded(true);
          setHasError(true);
        }}
      />
    </>
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
  const [pageInfoMap, setPageInfoMap] = useState<Map<number, DoubleSpreadInfo>>(new Map());
  const [effectivePageCount, setEffectivePageCount] = useState<number>(0);
  const preloadedRef = useRef<Set<number>>(new Set());
  const saveProgress = useMutation(api.readingProgress.saveProgress);
  const checkedPagesRef = useRef<Set<number>>(new Set());

  // Function to check if a page is a double-spread
  const checkDoubleSpread = async (pageIndex: number): Promise<DoubleSpreadInfo> => {
    if (!volumeData?.pages) {
      return { isDoubleSpread: false, imageUrl: "", coversPages: [pageIndex] };
    }

    const baseUrl = volumeData.pages[pageIndex]!;
    const baseUrlParts = baseUrl.split("/");
    const fileName = baseUrlParts[baseUrlParts.length - 1]!; // e.g., "050.webp"
    const volumePath = baseUrlParts.slice(0, -1).join("/");
    const pageNum = parseInt(fileName.replace(".webp", ""), 10);

    // Try the standard single page first
    const singlePageExists = await checkImageExists(baseUrl);
    if (singlePageExists) {
      return { isDoubleSpread: false, imageUrl: baseUrl, coversPages: [pageIndex] };
    }

    // Try double-spread patterns: 049-050.webp and 050-051.webp
    const prevPageNum = pageNum - 1;
    const nextPageNum = pageNum + 1;

    const pattern1 = `${volumePath}/${String(prevPageNum).padStart(3, "0")}-${String(pageNum).padStart(3, "0")}.webp`;
    const pattern2 = `${volumePath}/${String(pageNum).padStart(3, "0")}-${String(nextPageNum).padStart(3, "0")}.webp`;

    // Check pattern 1 (prev-current)
    if (await checkImageExists(pattern1)) {
      return {
        isDoubleSpread: true,
        imageUrl: pattern1,
        coversPages: [pageIndex - 1, pageIndex].filter(i => i >= 0),
      };
    }

    // Check pattern 2 (current-next)
    if (await checkImageExists(pattern2)) {
      return {
        isDoubleSpread: true,
        imageUrl: pattern2,
        coversPages: [pageIndex, pageIndex + 1].filter(i => i < volumeData.pages.length),
      };
    }

    // Fallback: return the original URL even if it doesn't exist
    return { isDoubleSpread: false, imageUrl: baseUrl, coversPages: [pageIndex] };
  };

  // Helper to check if an image exists
  const checkImageExists = (url: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
  };

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
    checkedPagesRef.current.clear();
    setPageInfoMap(new Map());
    setEffectivePageCount(0);
  }, [volumeNumber]);

  // Update input when navigating pages
  useEffect(() => {
    setInputPage(String(currentPage + 1));
  }, [currentPage]);

  // Check current page for double-spread and preload next
  useEffect(() => {
    if (!volumeData?.pages) return;

    // Check if we already know about this page
    if (!checkedPagesRef.current.has(currentPage)) {
      checkedPagesRef.current.add(currentPage);

      // Check for double-spread
      checkDoubleSpread(currentPage).then((info) => {
        setPageInfoMap((prev) => {
          const newMap = new Map(prev);
          newMap.set(currentPage, info);
          return newMap;
        });
      });
    }

    // Preload next page
    const currentInfo = pageInfoMap.get(currentPage);
    const nextPage = currentInfo?.isDoubleSpread
      ? Math.max(...currentInfo.coversPages) + 1
      : currentPage + 1;

    if (nextPage < volumeData.pages.length && !preloadedRef.current.has(nextPage)) {
      const nextPageUrl = volumeData.pages[nextPage];
      if (nextPageUrl) {
        const img = new Image();
        img.src = nextPageUrl;
        preloadedRef.current.add(nextPage);

        // Also check if next page is a double-spread
        if (!checkedPagesRef.current.has(nextPage)) {
          checkedPagesRef.current.add(nextPage);
          checkDoubleSpread(nextPage).then((info) => {
            setPageInfoMap((prev) => {
              const newMap = new Map(prev);
              newMap.set(nextPage, info);
              return newMap;
            });
          });
        }
      }
    }
  }, [currentPage, volumeData, pageInfoMap]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!volumeData?.pages) return;

      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        goToNextPage();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        goToPreviousPage();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentPage, volumeData, pageInfoMap]);

  // Calculate effective page count considering double-spreads
  useEffect(() => {
    if (!volumeData?.pages) return;

    let effectiveCount = 0;
    let i = 0;
    const seenPages = new Set<number>();

    while (i < volumeData.pages.length) {
      const info = pageInfoMap.get(i);
      if (info?.isDoubleSpread) {
        // Count this as one effective page, mark all covered pages as seen
        info.coversPages.forEach((p) => seenPages.add(p));
        effectiveCount++;
        // Skip to the page after the double-spread
        i = Math.max(...info.coversPages) + 1;
      } else {
        if (!seenPages.has(i)) {
          effectiveCount++;
        }
        i++;
      }
    }

    setEffectivePageCount(effectiveCount);
  }, [pageInfoMap, volumeData]);

  const goToPage = (pageIndex: number) => {
    if (!volumeData?.pages) return;
    if (pageIndex >= 0 && pageIndex < volumeData.pages.length) {
      setCurrentPage(pageIndex);
    }
  };

  const goToNextPage = () => {
    const currentInfo = pageInfoMap.get(currentPage);
    if (currentInfo?.isDoubleSpread) {
      // Skip to the page after the double-spread
      const lastCoveredPage = Math.max(...currentInfo.coversPages);
      goToPage(lastCoveredPage + 1);
    } else {
      goToPage(currentPage + 1);
    }
  };

  const goToPreviousPage = () => {
    // Find if we're coming from a double-spread
    let targetPage = currentPage - 1;

    // Check if the previous page is part of a double-spread that ends at currentPage
    for (let i = currentPage - 1; i >= 0; i--) {
      const info = pageInfoMap.get(i);
      if (info?.isDoubleSpread && info.coversPages.includes(currentPage - 1)) {
        // The previous logical page is part of a double-spread
        targetPage = i;
        break;
      }
    }

    goToPage(targetPage);
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
          <a href="#" onClick={(e) => { e.preventDefault(); goToPreviousPage(); }} style={{ marginRight: "10px" }}>
            ← Previous
          </a>
        )}
        <span>
          {((): string => {
            const info = pageInfoMap.get(currentPage);
            if (info?.isDoubleSpread && info.coversPages.length > 1) {
              const startPage = Math.min(...info.coversPages) + 1;
              const endPage = Math.max(...info.coversPages) + 1;
              return `Pages ${startPage}-${endPage} of ${volume.pageCount}`;
            }
            return `Page ${currentPage + 1} of ${volume.pageCount}`;
          })()}
        </span>
        {(() => {
          const info = pageInfoMap.get(currentPage);
          const nextIndex = info?.isDoubleSpread
            ? Math.max(...info.coversPages) + 1
            : currentPage + 1;
          return nextIndex < pages.length && (
            <a href="#" onClick={(e) => { e.preventDefault(); goToNextPage(); }} style={{ marginLeft: "10px" }}>
              Next →
            </a>
          );
        })()}
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
        <DoubleSpreadImage
          pageInfo={pageInfoMap.get(currentPage)}
          fallbackUrl={pages[currentPage]!}
          pageNumber={currentPage + 1}
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
              const currentInfo = pageInfoMap.get(currentPage);
              const pageUrl = currentInfo?.imageUrl || pages[currentPage]!;
              await saveProgress({
                mangaId: mangaId as any,
                volumeNumber,
                pageNumber: currentPage + 1,
                pageUrl: pageUrl,
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
