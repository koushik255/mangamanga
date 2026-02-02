import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api.js";

interface MangaListProps {
  onSelectManga: (slug: string) => void;
}

export function MangaList({ onSelectManga }: MangaListProps) {
  const mangaList = useQuery(api.manga.listManga);
  const lastRead = useQuery(api.readingProgress.getLastRead);

  if (mangaList === undefined) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h1 style={{ margin: 0 }}>Manga Library</h1>
        
        {lastRead && (
          <a href="#" onClick={(e) => { e.preventDefault(); onSelectManga(lastRead.mangaSlug); }}>
            Continue: {lastRead.mangaTitle} - Vol {lastRead.volumeNumber} Page {lastRead.pageNumber}
          </a>
        )}
      </div>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {mangaList.map((manga) => (
          <li key={manga._id} style={{ marginBottom: "20px", border: "1px solid #ccc", padding: "10px" }}>
            <img 
              src={manga.coverUrl} 
              alt={manga.title}
              style={{ width: "150px", height: "auto" }}
            />
            <h2>{manga.title}</h2>
            <p>Status: {manga.status}</p>
            <p>Total Volumes: {manga.totalVolumes}</p>
            {manga.description && <p>{manga.description}</p>}
            <a href="#" onClick={(e) => { e.preventDefault(); onSelectManga(manga.slug); }}>
              Read Manga →
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
