import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api.js";

interface MangaListProps {
  onSelectManga: (slug: string) => void;
}

export function MangaList({ onSelectManga }: MangaListProps) {
  const mangaList = useQuery(api.manga.listManga);

  if (mangaList === undefined) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <h1>Manga Library</h1>
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
            <button 
              onClick={() => onSelectManga(manga.slug)}
              style={{ 
                marginTop: "10px",
                padding: "10px 20px",
                fontSize: "16px",
                cursor: "pointer",
                backgroundColor: "#007bff",
                color: "white",
                border: "none",
                borderRadius: "4px"
              }}
            >
              Read Manga →
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
