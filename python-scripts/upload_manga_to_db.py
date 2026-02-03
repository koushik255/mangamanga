#!/usr/bin/env python3
"""
Upload Manga to Convex Database Script
Reads R2 bucket structure and adds manga/volumes to database

Usage:
    uv run upload_manga_to_db.py --slug steel-ball-run --title "Steel Ball Run"
"""

import os
import re
from pathlib import Path
from typing import Optional

import boto3
import typer
from dotenv import load_dotenv
from rich.console import Console
from rich.panel import Panel
from rich.text import Text
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.table import Table
from convex import ConvexClient

# Load environment variables
load_dotenv()

console = Console()
app = typer.Typer(help="Upload manga to Convex database from R2 bucket structure")

# Initialize Convex client
CONVEX_URL = os.getenv("VITE_CONVEX_URL") or os.getenv("CONVEX_URL")
if CONVEX_URL:
    convex_client = ConvexClient(CONVEX_URL)
else:
    convex_client = None


def pad_number(num: int, length: int = 3) -> str:
    return str(num).zfill(length)


def get_r2_client():
    """Create and return R2 S3 client."""
    access_key = os.getenv("R2_ACCESS_KEY_ID")
    secret_key = os.getenv("R2_SECRET_ACCESS_KEY")
    bucket_url = os.getenv("R2_BUCKET_URL")

    if not all([access_key, secret_key, bucket_url]):
        return None

    return boto3.client(
        "s3",
        region_name="auto",
        endpoint_url=bucket_url,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
    )


def list_volume_folders(slug: str) -> list[tuple[int, int]]:
    """
    List all volume folders in R2 and return (volume_number, file_count) tuples.
    Returns sorted by volume number.
    """
    s3_client = get_r2_client()
    if not s3_client:
        raise ValueError("R2 credentials not configured")

    bucket_name = os.getenv("R2_BUCKET_NAME", "manga")
    manga_prefix = f"manga/{slug}/"

    try:
        # List all objects under the manga slug
        response = s3_client.list_objects_v2(
            Bucket=bucket_name, Prefix=manga_prefix, Delimiter="/"
        )

        volumes = []

        # Find all volume-{NNN} folders
        for prefix in response.get("CommonPrefixes", []):
            folder = prefix.get("Prefix", "")
            # Extract volume number from "manga/{slug}/volume-{NNN}/"
            match = re.search(r"volume-(\d+)/", folder)
            if match:
                vol_num = int(match.group(1))

                # Count files in this volume
                vol_response = s3_client.list_objects_v2(
                    Bucket=bucket_name, Prefix=folder
                )

                file_count = len(vol_response.get("Contents", []))
                volumes.append((vol_num, file_count))

        # Sort by volume number
        volumes.sort(key=lambda x: x[0])
        return volumes

    except Exception as e:
        raise ValueError(f"Failed to list R2 folders: {e}")


def get_existing_manga_by_slug(slug: str) -> Optional[dict]:
    """Check if manga already exists in database by slug."""
    if not convex_client:
        return None

    try:
        manga_list = convex_client.query("manga:listManga")
        for manga in manga_list:
            if manga.get("slug") == slug:
                return manga
        return None
    except Exception as e:
        console.print(
            f"[yellow]Warning: Could not check for existing manga: {e}[/yellow]"
        )
        return None


def create_manga(
    title: str, slug: str, cover_url: str, total_volumes: int, status: str = "completed"
) -> str:
    """Create new manga in Convex."""
    if not convex_client:
        raise ValueError(
            "Convex client not initialized. Set VITE_CONVEX_URL or CONVEX_URL."
        )

    try:
        result = convex_client.mutation(
            "manga:createManga",
            {
                "title": title,
                "slug": slug,
                "coverUrl": cover_url,
                "totalVolumes": total_volumes,
                "status": status,
            },
        )
        manga_id = result if isinstance(result, str) else str(result)
        return manga_id
    except Exception as e:
        console.print(f"[red]Error creating manga: {e}[/red]")
        raise


def add_volume(manga_id: str, volume_number: int, page_count: int) -> Optional[str]:
    """Add volume to manga in Convex. Returns volume_id or None if skipped."""
    if not convex_client:
        raise ValueError("Convex client not initialized")

    try:
        result = convex_client.mutation(
            "manga:addVolume",
            {
                "mangaId": manga_id,
                "volumeNumber": volume_number,
                "pageCount": page_count,
            },
        )
        volume_id = result if isinstance(result, str) else str(result)
        return volume_id
    except Exception as e:
        error_msg = str(e).lower()
        # If it's a duplicate error, return None to indicate skip
        if "already exists" in error_msg or "duplicate" in error_msg:
            return None
        console.print(f"[red]Error adding volume {volume_number}: {e}[/red]")
        raise


@app.command()
def main(
    slug: str = typer.Option(..., "--slug", "-s", help="Manga slug (R2 folder name)"),
    title: str = typer.Option(..., "--title", "-t", help="Manga title"),
    status: str = typer.Option(
        "completed", "--status", help="Manga status (ongoing/completed)"
    ),
    cdn_base: str = typer.Option(
        "https://cdn.koushikkoushik.com", "--cdn-base", help="CDN base URL"
    ),
    yes: bool = typer.Option(False, "--yes", "-y", help="Skip confirmation prompts"),
):
    """Upload manga to Convex database based on R2 bucket structure"""

    # Check convex client
    if not convex_client:
        console.print(
            "[red]Error: Convex client not initialized. "
            "Set VITE_CONVEX_URL or CONVEX_URL environment variable.[/red]"
        )
        raise typer.Exit(1)

    console.print(
        Panel(
            Text.from_markup(
                f"[bold blue]Upload Manga to Database[/bold blue]\n"
                f"Title: {title}\n"
                f"Slug: {slug}\n"
                f"Status: {status}\n"
                f"CDN Base: {cdn_base}"
            ),
            title="Configuration",
            border_style="blue",
        )
    )

    # ============================================================================
    # STEP 1: Scan R2 bucket for volumes
    # ============================================================================
    console.print("\n[bold]Step 1: Scanning R2 Bucket Structure[/bold]")

    try:
        volumes = list_volume_folders(slug)
    except ValueError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)

    if not volumes:
        console.print(f"[red]No volume folders found in R2 for slug '{slug}'[/red]")
        console.print(
            f"[yellow]Expected path: manga/{slug}/volume-001/, volume-002/, etc.[/yellow]"
        )
        raise typer.Exit(1)

    total_volumes = len(volumes)
    total_files = sum(count for _, count in volumes)

    # Display volume table
    table = Table(
        title=f"Found {total_volumes} Volumes in R2",
        show_header=True,
        header_style="bold blue",
    )
    table.add_column("Volume", style="cyan", justify="right")
    table.add_column("Files", style="yellow", justify="right")
    table.add_column("R2 Path", style="green")

    for vol_num, file_count in volumes:
        r2_path = f"manga/{slug}/volume-{pad_number(vol_num)}/"
        table.add_row(str(vol_num), str(file_count), r2_path)

    table.add_row("", "", "")
    table.add_row("[bold]Total", f"[bold]{total_files}[/bold]", "")

    console.print(table)

    # ============================================================================
    # STEP 2: Check for existing manga
    # ============================================================================
    console.print("\n[bold]Step 2: Checking Database[/bold]")

    existing_manga = get_existing_manga_by_slug(slug)

    if existing_manga:
        manga_id = existing_manga.get("_id")
        existing_title = existing_manga.get("title", "Unknown")
        existing_volumes = existing_manga.get("totalVolumes", 0)

        console.print(f"[yellow]Manga already exists in database:[/yellow]")
        console.print(f"  Title: {existing_title}")
        console.print(f"  Current volumes: {existing_volumes}")
        console.print(f"  Found in R2: {total_volumes} volumes")

        if not yes:
            confirm = (
                input(f"\nAppend {total_volumes} volumes to existing manga? [Y/n]: ")
                .strip()
                .upper()
            )
            if confirm in ["N", "NO"]:
                console.print("[red]Operation cancelled.[/red]")
                raise typer.Exit(0)
    else:
        console.print(f"[green]No existing manga found with slug '{slug}'[/green]")
        manga_id = None

    # ============================================================================
    # STEP 3: Create manga if needed and add volumes sequentially
    # ============================================================================
    console.print("\n[bold]Step 3: Adding to Database[/bold]")

    # Track what we add
    added_volumes = []
    skipped_volumes = []

    # Create manga if it doesn't exist
    if not manga_id:
        cover_url = f"{cdn_base}/manga/{slug}/volume-001/001.webp"
        console.print(f"\n[blue]Creating manga record...[/blue]")

        try:
            manga_id = create_manga(title, slug, cover_url, total_volumes, status)
            console.print(f"[green]Created manga with ID: {manga_id}[/green]")
        except Exception as e:
            console.print(f"[red]Failed to create manga: {e}[/red]")
            raise typer.Exit(1)
    else:
        console.print(f"[blue]Using existing manga ID: {manga_id}[/blue]")

    # Add volumes sequentially
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console,
    ) as progress:
        task = progress.add_task("Adding volumes...", total=len(volumes))

        for i, (vol_num, file_count) in enumerate(volumes, 1):
            progress.update(
                task, description=f"Adding Volume {vol_num}/{total_volumes}..."
            )

            try:
                # Check if volume already exists (we'll handle duplicates gracefully)
                volume_id = add_volume(manga_id, vol_num, file_count)

                if volume_id:
                    added_volumes.append((vol_num, file_count, volume_id))
                    console.print(
                        f"[green]  ✓ Volume {vol_num}: {file_count} pages added[/green]"
                    )
                else:
                    skipped_volumes.append((vol_num, file_count))
                    console.print(
                        f"[yellow]  ⊘ Volume {vol_num}: already exists, skipped[/yellow]"
                    )

            except Exception as e:
                console.print(f"[red]  ✗ Volume {vol_num} failed: {e}[/red]")
                raise typer.Exit(1)

            progress.update(task, advance=1)

    # ============================================================================
    # FINAL SUMMARY
    # ============================================================================
    summary_text = (
        f"[bold green]Database Upload Complete![/bold green]\n\n"
        f"Manga: {title}\n"
        f"Slug: {slug}\n"
        f"Manga ID: {manga_id}\n\n"
    )

    if added_volumes:
        summary_text += f"Volumes Added: {len(added_volumes)}\n"
        for vol_num, count, vid in added_volumes:
            summary_text += f"  Volume {vol_num}: {count} pages\n"

    if skipped_volumes:
        summary_text += f"\nVolumes Skipped (already exist): {len(skipped_volumes)}\n"
        for vol_num, count in skipped_volumes:
            summary_text += f"  Volume {vol_num}: {count} files\n"

    summary_text += f"\nTotal volumes in database: {len(added_volumes) + len(skipped_volumes)}/{total_volumes}"

    console.print(
        Panel(
            Text.from_markup(summary_text),
            title="Success",
            border_style="green",
        )
    )


if __name__ == "__main__":
    app()
