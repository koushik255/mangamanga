#!/usr/bin/env python3


import os
import re
from pathlib import Path
from typing import Optional
from concurrent.futures import ProcessPoolExecutor, as_completed

import boto3
import typer
from dotenv import load_dotenv
from PIL import Image
from rich.console import Console
from rich.panel import Panel
from rich.text import Text
from rich.progress import (
    Progress,
    SpinnerColumn,
    TextColumn,
    BarColumn,
    TaskProgressColumn,
)
from rich.table import Table
from convex import ConvexClient

# Load environment variables
load_dotenv()

console = Console()
app = typer.Typer(help="Upload complete manga (all volumes) to R2 and Convex")

# Initialize Convex client
CONVEX_URL = os.getenv("VITE_CONVEX_URL") or os.getenv("CONVEX_URL")
if CONVEX_URL:
    convex_client = ConvexClient(CONVEX_URL)
else:
    convex_client = None


def pad_number(num: int, length: int = 3) -> str:
    return str(num).zfill(length)


def extract_volume_number(folder_name: str) -> int:
    """Extract volume number from folder name using multiple patterns."""
    patterns = [
        r"v(?:ol)?(?:ume)?\s*(\d+)",  # v01, vol01, volume01, v 01, vol 01, volume 01
        r"volume[_\s-]*(\d+)",  # volume_01, volume-01
        r"vol[_\s-]*(\d+)",  # vol_01, vol-01
        r"^\s*(\d+)\s*$",  # just a number
    ]

    folder_lower = folder_name.lower()
    for pattern in patterns:
        match = re.search(pattern, folder_lower, re.IGNORECASE)
        if match:
            return int(match.group(1))
    return 0


def generate_slug(title: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", title.lower())
    return slug.strip("-")


def find_volume_folders(source_path: Path) -> list[tuple[int, Path]]:
    """Find all volume folders and return (volume_number, path) tuples sorted by volume number."""
    volumes = []

    if not source_path.exists():
        raise ValueError(f"Source path does not exist: {source_path}")

    for entry in source_path.iterdir():
        if entry.is_dir():
            vol_num = extract_volume_number(entry.name)
            if vol_num > 0:
                volumes.append((vol_num, entry))

    # Sort by volume number
    volumes.sort(key=lambda x: x[0])
    return volumes


def find_image_files(directory: Path) -> list[Path]:
    """Find all image files (PNG, JPG, JPEG) recursively in directory."""
    image_files = []
    for ext in ["*.png", "*.jpg", "*.jpeg", "*.PNG", "*.JPG", "*.JPEG"]:
        image_files.extend(directory.rglob(ext))
    return sorted(image_files)


def count_images_in_volume(vol_path: Path) -> int:
    """Count all image files recursively in a volume directory."""
    return len(find_image_files(vol_path))


def convert_single_volume(
    volume_num: int, source_path: Path, output_path: Path, quality: int
) -> tuple[int, int]:
    """Convert a single volume from PNG to WebP. Returns (converted_count, errors)."""
    png_files = find_image_files(source_path)
    if not png_files:
        raise ValueError(f"No image files found in {source_path}")

    volume_folder = output_path / f"volume-{pad_number(volume_num)}"
    volume_folder.mkdir(parents=True, exist_ok=True)

    converted = 0
    errors = 0
    total_files = len(png_files)

    for i, png_path in enumerate(png_files, 1):
        output_file = volume_folder / f"{pad_number(i)}.webp"
        try:
            with Image.open(png_path) as img:
                img.save(output_file, "WEBP", quality=quality, method=6)
            converted += 1
            # Print progress every file
            print(
                f"  Vol {volume_num}: [{i}/{total_files}] {png_path.name} -> {output_file.name}",
                flush=True,
            )
        except Exception as e:
            errors += 1
            print(
                f"  [ERROR] Vol {volume_num}: Failed to convert {png_path.name}: {e}",
                flush=True,
            )
            raise  # Re-raise to stop completely

    return converted, errors


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


def upload_single_volume_to_r2(
    volume_num: int, webp_folder: Path, manga_slug: str
) -> tuple[int, int]:
    """Upload a single volume to R2. Returns (uploaded_count, errors)."""
    s3_client = get_r2_client()
    if not s3_client:
        raise ValueError("R2 credentials not configured")

    bucket_name = os.getenv("R2_BUCKET_NAME", "manga")
    webp_files = sorted(webp_folder.glob("*.webp"))

    if not webp_files:
        raise ValueError(f"No WebP files found in {webp_folder}")

    uploaded = 0
    errors = 0
    folder_prefix = f"manga/{manga_slug}/volume-{pad_number(volume_num)}/"

    for webp_file in webp_files:
        key = f"{folder_prefix}{webp_file.name}"
        try:
            s3_client.upload_file(
                str(webp_file),
                bucket_name,
                key,
                ExtraArgs={
                    "ContentType": "image/webp",
                    "CacheControl": "public, max-age=31536000, immutable",
                },
            )
            uploaded += 1
        except Exception as e:
            errors += 1
            console.print(
                f"[red]Error uploading {webp_file} for Volume {volume_num}: {e}[/red]"
            )
            raise  # Re-raise to stop completely

    return uploaded, errors


def create_manga(
    title: str, slug: str, cover_url: str, total_volumes: int, status: str = "ongoing"
) -> str:
    """Create new manga in Convex."""
    if not convex_client:
        raise ValueError("Convex client not initialized")

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


def add_volume(manga_id: str, volume_number: int, page_count: int) -> str:
    """Add volume to manga in Convex."""
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
        console.print(f"[red]Error adding volume {volume_number}: {e}[/red]")
        raise


@app.command()
def main(
    source: str = typer.Option(
        ..., "--source", "-s", help="Source directory containing volume folders"
    ),
    title: str = typer.Option(..., "--title", "-t", help="Manga title"),
    slug: Optional[str] = typer.Option(
        None,
        "--slug",
        help="Manga slug (auto-generated from title if not provided)",
    ),
    output: Optional[str] = typer.Option(
        None, "--output", "-o", help="Output directory for WebP files"
    ),
    quality: int = typer.Option(85, "--quality", "-q", help="WebP quality (1-100)"),
    status: str = typer.Option(
        "completed", "--status", help="Manga status (ongoing/completed)"
    ),
    max_workers: int = typer.Option(
        4, "--max-workers", "-w", help="Maximum parallel workers for processing"
    ),
    skip_convert: bool = typer.Option(
        False,
        "--skip-convert",
        help="Skip PNG to WebP conversion (use existing WebP files)",
    ),
    skip_r2: bool = typer.Option(
        False, "--skip-r2", help="Skip R2 upload (just convert and add to DB)"
    ),
    skip_db: bool = typer.Option(
        False,
        "--skip-db",
        help="Skip database operations (just convert and upload to R2)",
    ),
    yes: bool = typer.Option(
        False, "--yes", "-y", help="Skip confirmation prompts and proceed automatically"
    ),
):
    """Upload complete manga (all volumes) to R2 and Convex"""

    # Generate slug if not provided
    if not slug:
        slug = generate_slug(title)

    console.print(
        Panel(
            Text.from_markup(
                f"[bold blue]Full Manga Upload Script[/bold blue]\n"
                f"Title: {title}\n"
                f"Slug: {slug}\n"
                f"Source: {source}\n"
                f"Max Workers: {max_workers}\n"
                f"WebP Quality: {quality}"
            ),
            title="Configuration",
            border_style="blue",
        )
    )

    # ============================================================================
    # STEP 1: Discover volumes and count PNGs
    # ============================================================================
    console.print("\n[bold]Step 1: Discovering Volumes and Counting PNGs[/bold]")

    source_path = Path(source)
    try:
        volumes = find_volume_folders(source_path)
    except ValueError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)

    if not volumes:
        console.print(f"[red]No volume folders found in {source_path}[/red]")
        raise typer.Exit(1)

    # Count PNGs in each volume
    volume_png_counts = {}
    for vol_num, vol_path in volumes:
        png_count = count_images_in_volume(vol_path)
        volume_png_counts[vol_num] = png_count

    # Display summary table
    table = Table(
        title=f"Found {len(volumes)} Volumes",
        show_header=True,
        header_style="bold blue",
    )
    table.add_column("Volume", style="cyan", justify="right")
    table.add_column("Folder Name", style="green")
    table.add_column("Image Count", style="yellow", justify="right")

    total_pngs = 0
    for vol_num, vol_path in volumes:
        png_count = volume_png_counts[vol_num]
        total_pngs += png_count
        table.add_row(str(vol_num), vol_path.name, str(png_count))

    table.add_row("", "", "")
    table.add_row("[bold]Total", "", f"[bold]{total_pngs}[/bold]")

    console.print(table)

    output_base = Path(output) if output else Path("./output") / slug
    total_volumes = len(volumes)

    # ============================================================================
    # STEP 2: Convert all volumes in parallel
    # ============================================================================
    if not skip_convert:
        console.print(
            f"\n[bold]Step 2: Converting PNG to WebP (parallel, {max_workers} workers)[/bold]"
        )

        volume_page_counts = {}

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            console=console,
        ) as progress:
            task = progress.add_task("Converting volumes...", total=len(volumes))

            with ProcessPoolExecutor(max_workers=max_workers) as executor:
                # Submit all conversion tasks
                futures = {
                    executor.submit(
                        convert_single_volume, vol_num, vol_path, output_base, quality
                    ): vol_num
                    for vol_num, vol_path in volumes
                }

                # Collect results as they complete
                for future in as_completed(futures):
                    vol_num = futures[future]
                    try:
                        converted, errors = future.result()
                        volume_page_counts[vol_num] = converted
                        progress.update(task, advance=1)
                        console.print(
                            f"[green]✓ Volume {vol_num}: {converted} pages converted[/green]"
                        )
                    except Exception as e:
                        console.print(f"[red]✗ Volume {vol_num} failed: {e}[/red]")
                        raise typer.Exit(1)
    else:
        console.print(
            "\n[yellow]Skipping conversion - counting existing WebP files[/yellow]"
        )
        volume_page_counts = {}
        for vol_num, _ in volumes:
            volume_output = output_base / f"volume-{pad_number(vol_num)}"
            page_count = len(list(volume_output.glob("*.webp")))
            volume_page_counts[vol_num] = page_count
            console.print(f"  Volume {vol_num}: {page_count} pages found")

    # ============================================================================
    # STEP 3: Confirm and Upload all volumes to R2 in parallel
    # ============================================================================
    if not skip_r2:
        # Show upload summary and ask for confirmation
        console.print("\n[bold]Step 3: R2 Upload Preparation[/bold]")

        upload_table = Table(
            title="R2 Upload Summary", show_header=True, header_style="bold magenta"
        )
        upload_table.add_column("Volume", style="cyan", justify="right")
        upload_table.add_column("Files to Upload", style="yellow", justify="right")
        upload_table.add_column("R2 Path", style="green")

        total_files = 0
        for vol_num, _ in volumes:
            page_count = volume_page_counts.get(vol_num, 0)
            total_files += page_count
            r2_path = f"manga/{slug}/volume-{pad_number(vol_num)}/"
            upload_table.add_row(str(vol_num), str(page_count), r2_path)

        upload_table.add_row("", "", "")
        upload_table.add_row(
            "[bold]Total",
            f"[bold]{total_files}[/bold]",
            f"[dim]Base: manga/{slug}/[/dim]",
        )

        console.print(upload_table)

        # Ask for confirmation unless --yes flag is set
        if not yes:
            try:
                confirm = (
                    input(
                        f"\nProceed with uploading {total_files} files to R2? [Y/n]: "
                    )
                    .strip()
                    .upper()
                )

                # Default to Y if empty, cancel if N
                if confirm in ["N", "NO"]:
                    console.print("[red]Upload cancelled by user.[/red]")
                    raise typer.Exit(0)
                # Accept Y, YES, or empty (default Y)
            except (EOFError, KeyboardInterrupt):
                console.print("[red]Upload cancelled.[/red]")
                raise typer.Exit(0)

        console.print(
            f"\n[bold]Uploading to R2 (parallel, {max_workers} workers)...[/bold]"
        )

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            console=console,
        ) as progress:
            task = progress.add_task("Uploading volumes...", total=len(volumes))

            with ProcessPoolExecutor(max_workers=max_workers) as executor:
                # Submit all upload tasks
                futures = {
                    executor.submit(
                        upload_single_volume_to_r2,
                        vol_num,
                        output_base / f"volume-{pad_number(vol_num)}",
                        slug,
                    ): vol_num
                    for vol_num, _ in volumes
                }

                # Collect results as they complete
                for future in as_completed(futures):
                    vol_num = futures[future]
                    try:
                        uploaded, errors = future.result()
                        progress.update(task, advance=1)
                        console.print(
                            f"[green]✓ Volume {vol_num}: {uploaded} files uploaded[/green]"
                        )
                    except Exception as e:
                        console.print(
                            f"[red]✗ Volume {vol_num} upload failed: {e}[/red]"
                        )
                        raise typer.Exit(1)
    else:
        console.print("\n[yellow]Skipping R2 upload[/yellow]")

    # ============================================================================
    # STEP 4: Create manga and add all volumes to Convex
    # ============================================================================
    if not skip_db:
        console.print(
            "\n[bold]Step 4: Creating Manga and Adding Volumes to Convex[/bold]"
        )

        if not convex_client:
            console.print(
                "[red]Convex client not available. Set VITE_CONVEX_URL or CONVEX_URL environment variable.[/red]"
            )
            raise typer.Exit(1)

        # Create manga entry
        cover_url = f"https://cdn.koushikkoushik.com/manga/{slug}/volume-001/001.webp"

        try:
            manga_id = create_manga(title, slug, cover_url, total_volumes, status)
            console.print(f"[green]Created manga with ID: {manga_id}[/green]")
        except Exception as e:
            console.print(f"[red]Failed to create manga: {e}[/red]")
            raise typer.Exit(1)

        # Add all volumes
        for vol_num, _ in volumes:
            page_count = volume_page_counts.get(vol_num, 0)
            try:
                volume_id = add_volume(manga_id, vol_num, page_count)
                console.print(
                    f"[green]Added Volume {vol_num} ({page_count} pages)[/green]"
                )
            except Exception as e:
                console.print(f"[red]Failed to add Volume {vol_num}: {e}[/red]")
                raise typer.Exit(1)
    else:
        console.print("\n[yellow]Skipping database operations[/yellow]")

    # ============================================================================
    # FINAL SUMMARY
    # ============================================================================
    summary_text = (
        f"[bold green]Full Manga Upload Complete![/bold green]\n\n"
        f"Manga: {title}\n"
        f"Slug: {slug}\n"
        f"Total Volumes: {total_volumes}\n"
        f"Status: {status}\n\n"
        f"Volume Details:\n"
    )

    for vol_num, _ in volumes:
        page_count = volume_page_counts.get(vol_num, 0)
        summary_text += f"  Volume {vol_num}: {page_count} pages\n"

    if not skip_r2:
        summary_text += f"\nR2 Base Path: manga/{slug}/"

    console.print(
        Panel(
            Text.from_markup(summary_text),
            title="Success",
            border_style="green",
        )
    )


if __name__ == "__main__":
    app()
