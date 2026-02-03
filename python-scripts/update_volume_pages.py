#!/usr/bin/env python3
"""
Update Volume Pages Script
Compares R2 bucket structure with database and updates page counts

Usage:
    uv run update_volume_pages.py --slug steel-ball-run
"""

import os
import re
from pathlib import Path
from typing import Optional, Tuple

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
app = typer.Typer(help="Update manga volume page counts in database from R2 bucket")

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


def list_volume_folders(slug: str) -> list[Tuple[int, int]]:
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


def get_manga_by_slug(slug: str) -> Optional[dict]:
    """Get manga from database by slug using getMangaBySlug API."""
    if not convex_client:
        return None

    try:
        # Use getMangaBySlug to get manga with volumes
        result = convex_client.query("manga:getMangaBySlug", {"slug": slug})
        return result
    except Exception as e:
        console.print(f"[red]Error fetching manga: {e}[/red]")
        return None


def get_volumes_for_manga(slug: str) -> dict[int, dict]:
    """Get all volumes for a manga from database.

    Returns dict mapping volume_number -> volume data (including pageCount)
    """
    volumes_data = {}

    if not convex_client:
        return volumes_data

    try:
        manga = convex_client.query("manga:getMangaBySlug", {"slug": slug})
        if manga and "volumes" in manga:
            for volume in manga["volumes"]:
                vol_num = volume.get("volumeNumber")
                if vol_num is not None:
                    volumes_data[vol_num] = volume
        return volumes_data
    except Exception as e:
        console.print(f"[red]Error fetching volumes: {e}[/red]")
        return volumes_data


def update_volume_page_count(
    manga_id: str, volume_number: int, page_count: int
) -> bool:
    """Update page count for a volume."""
    if not convex_client:
        return False

    try:
        # Try to use updateVolume mutation
        result = convex_client.mutation(
            "manga:updateVolume",
            {
                "mangaId": manga_id,
                "volumeNumber": volume_number,
                "pageCount": page_count,
            },
        )
        return True
    except Exception as e:
        console.print(f"[yellow]Note: {e}[/yellow]")
        return False


@app.command()
def main(
    slug: str = typer.Option(..., "--slug", "-s", help="Manga slug to update"),
    yes: bool = typer.Option(
        False, "--yes", "-y", help="Skip confirmation and update automatically"
    ),
    dry_run: bool = typer.Option(
        False, "--dry-run", help="Show what would be updated without making changes"
    ),
):
    """Update volume page counts in database from R2 bucket structure"""

    if not convex_client:
        console.print(
            "[red]Error: Convex client not initialized. "
            "Set VITE_CONVEX_URL or CONVEX_URL environment variable.[/red]"
        )
        raise typer.Exit(1)

    console.print(
        Panel(
            Text.from_markup(
                f"[bold blue]Update Volume Pages[/bold blue]\n"
                f"Slug: {slug}\n"
                f"Mode: {'Dry Run' if dry_run else 'Update'}"
            ),
            title="Configuration",
            border_style="blue",
        )
    )

    # ============================================================================
    # STEP 1: Check if manga exists
    # ============================================================================
    console.print("\n[bold]Step 1: Checking Database[/bold]")

    manga = get_manga_by_slug(slug)
    if not manga:
        console.print(
            f"[red]Error: Manga with slug '{slug}' not found in database.[/red]"
        )
        console.print(
            "[yellow]Run 'upload_manga_to_db.py' first to create the manga.[/yellow]"
        )
        raise typer.Exit(1)

    # getMangaBySlug returns {manga: {...}, volumes: [...]}
    manga_data = manga.get("manga", {})
    volumes_data = manga.get("volumes", [])
    manga_id = manga_data.get("_id")
    manga_title = manga_data.get("title", "Unknown")

    console.print(f"[green]Found manga: {manga_title} (ID: {manga_id})[/green]")

    # ============================================================================
    # STEP 2: Scan R2 bucket
    # ============================================================================
    console.print("\n[bold]Step 2: Scanning R2 Bucket[/bold]")

    try:
        r2_volumes = list_volume_folders(slug)
    except ValueError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)

    if not r2_volumes:
        console.print(f"[red]No volumes found in R2 for slug '{slug}'[/red]")
        raise typer.Exit(1)

    console.print(f"[green]Found {len(r2_volumes)} volumes in R2[/green]")

    # ============================================================================
    # STEP 3: Get database volumes with page counts
    # ============================================================================
    console.print("\n[bold]Step 3: Fetching Database Volumes[/bold]")

    db_volumes = get_volumes_for_manga(slug)
    console.print(f"[green]Found {len(db_volumes)} volumes in database[/green]")

    # Build dict of {volume_number: page_count} from database
    db_volume_pages = {
        vol_num: vol_data.get("pageCount", 0)
        for vol_num, vol_data in db_volumes.items()
    }

    # ============================================================================
    # STEP 4: Compare R2 vs Database
    # ============================================================================
    console.print("\n[bold]Step 4: Comparing R2 vs Database[/bold]")

    # Build comparison table
    table = Table(
        title="Volume Comparison",
        show_header=True,
        header_style="bold blue",
    )
    table.add_column("Volume", style="cyan", justify="right")
    table.add_column("R2 Files", style="green", justify="right")
    table.add_column("DB Pages", style="blue", justify="right")
    table.add_column("Status", style="yellow")

    changes_needed = []
    matches = 0
    needs_update = []
    missing_volumes = []
    unexpected_volumes = []

    # Get all unique volume numbers from both sources
    all_volumes = set(vol_num for vol_num, _ in r2_volumes) | set(
        db_volume_pages.keys()
    )

    for vol_num in sorted(all_volumes):
        r2_count = next((count for v, count in r2_volumes if v == vol_num), None)
        db_count = db_volume_pages.get(vol_num, None)

        if r2_count is not None and db_count is not None:
            # Volume exists in both
            if r2_count == db_count:
                status = "[green]Match ✓[/green]"
                matches += 1
            else:
                status = "[yellow]Needs Update[/yellow]"
                needs_update.append((vol_num, r2_count, db_count))
                changes_needed.append((vol_num, r2_count, "update"))
            table.add_row(str(vol_num), str(r2_count), str(db_count), status)

        elif r2_count is not None and db_count is None:
            # Volume exists in R2 but not in DB
            status = "[red]Missing from DB[/red]"
            missing_volumes.append((vol_num, r2_count))
            changes_needed.append((vol_num, r2_count, "add"))
            table.add_row(str(vol_num), str(r2_count), "N/A", status)

        elif r2_count is None and db_count is not None:
            # Volume exists in DB but not in R2
            status = "[red]Missing from R2[/red]"
            unexpected_volumes.append((vol_num, db_count))
            table.add_row(str(vol_num), "N/A", str(db_count), status)

    console.print(table)

    # Show detailed summary of mismatches
    console.print(f"\n[bold]Summary:[/bold]")
    console.print(f"  Total volumes found: {len(all_volumes)}")
    console.print(f"  [green]Matches: {matches} volumes[/green]")

    if needs_update:
        console.print(f"\n[yellow]Volumes needing page count updates:[/yellow]")
        for vol_num, r2_count, db_count in needs_update:
            console.print(
                f"  Volume {vol_num}: DB has {db_count} pages, R2 has {r2_count} files"
            )

    if missing_volumes:
        console.print(f"\n[red]Volumes missing from database:[/red]")
        for vol_num, r2_count in missing_volumes:
            console.print(f"  Volume {vol_num}: {r2_count} files in R2")

    if unexpected_volumes:
        console.print(f"\n[red]Volumes missing from R2 (in DB but not R2):[/red]")
        for vol_num, db_count in unexpected_volumes:
            console.print(f"  Volume {vol_num}: {db_count} pages in DB")

    # Show what would be done
    if changes_needed:
        console.print(f"\n[bold]Actions to be taken:[/bold]")
        console.print(
            f"  Update existing volumes: {len([c for c in changes_needed if c[2] == 'update'])}"
        )
        console.print(
            f"  Add new volumes: {len([c for c in changes_needed if c[2] == 'add'])}"
        )

    if dry_run:
        console.print("\n[yellow]Dry run complete. No changes made.[/yellow]")
        raise typer.Exit(0)

    if not changes_needed:
        console.print("\n[green]All volumes are up to date! No changes needed.[/green]")
        raise typer.Exit(0)

    # ============================================================================
    # STEP 5: Confirm and proceed
    # ============================================================================
    if not yes:
        confirm = (
            input(f"\nProceed with updating {len(changes_needed)} volumes? [Y/n]: ")
            .strip()
            .upper()
        )
        if confirm in ["N", "NO"]:
            console.print("[red]Operation cancelled.[/red]")
            raise typer.Exit(0)

    # ============================================================================
    # STEP 6: Update/Add volumes
    # ============================================================================
    console.print("\n[bold]Step 5: Updating Database[/bold]")

    updated = 0
    added = 0
    skipped = 0
    failed = 0

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console,
    ) as progress:
        task = progress.add_task("Processing volumes...", total=len(changes_needed))

        for vol_num, file_count, action in changes_needed:
            progress.update(task, description=f"Processing Volume {vol_num}...")

            try:
                if action == "add":
                    # Add new volume
                    result = convex_client.mutation(
                        "manga:addVolume",
                        {
                            "slug": slug,
                            "volumeNumber": vol_num,
                            "pageCount": file_count,
                        },
                    )
                    console.print(
                        f"[green]  + Volume {vol_num}: Added ({file_count} pages)[/green]"
                    )
                    added += 1

                elif action == "update":
                    # Update existing volume
                    success = update_volume_page_count(manga_id, vol_num, file_count)
                    if success:
                        console.print(
                            f"[green]  ↑ Volume {vol_num}: Updated to {file_count} pages[/green]"
                        )
                        updated += 1
                    else:
                        console.print(
                            f"[yellow]  ! Volume {vol_num}: Update not supported by API[/yellow]"
                        )
                        skipped += 1

            except Exception as e:
                console.print(f"[red]  ✗ Volume {vol_num}: Failed - {e}[/red]")
                failed += 1
                if failed >= 3:  # Stop after 3 failures
                    console.print("[red]Too many failures, stopping.[/red]")
                    break

            progress.update(task, advance=1)

    # ============================================================================
    # FINAL SUMMARY
    # ============================================================================
    summary_text = (
        f"[bold green]Update Complete![/bold green]\n\n"
        f"Manga: {manga_title}\n"
        f"Slug: {slug}\n\n"
        f"Results:\n"
        f"  [green]Updated: {updated} volumes[/green]\n"
        f"  [green]Added: {added} volumes[/green]\n"
    )

    if skipped > 0:
        summary_text += (
            f"  [yellow]Skipped: {skipped} volumes (API limitation)[/yellow]\n"
        )

    if failed > 0:
        summary_text += f"  [red]Failed: {failed} volumes[/red]\n"

    if matches > 0:
        summary_text += f"  [dim]Already correct: {matches} volumes[/dim]\n"

    console.print(
        Panel(
            Text.from_markup(summary_text),
            title="Success",
            border_style="green" if failed == 0 else "yellow",
        )
    )


if __name__ == "__main__":
    app()
