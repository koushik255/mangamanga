#!/usr/bin/env python3
"""
Manga Volume Upload Script - Simplified Flow

Usage:
    uv run upload_volume.py --volume 2 --title "Manga Title"
"""

import os
import re
from pathlib import Path
from typing import Optional
from dataclasses import dataclass

import boto3
import typer
from dotenv import load_dotenv
from PIL import Image
from rich.console import Console
from rich.panel import Panel
from rich.text import Text
from rich.live import Live
from rich.layout import Layout
from convex import ConvexClient

# Load environment variables
load_dotenv()

console = Console()
app = typer.Typer(help="Upload manga volumes to R2 and Convex")

# Initialize Convex client
# Check VITE_CONVEX_URL first (for Vite compatibility), then fall back to CONVEX_URL
CONVEX_URL = os.getenv("VITE_CONVEX_URL") or os.getenv("CONVEX_URL")
if CONVEX_URL:
    convex_client = ConvexClient(CONVEX_URL)
else:
    convex_client = None


def pad_number(num: int, length: int = 3) -> str:
    return str(num).zfill(length)


def extract_volume_number(folder_name: str) -> int:
    match = re.search(r"v(\d+)", folder_name, re.IGNORECASE)
    return int(match.group(1)) if match else 0


def generate_slug(title: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", title.lower())
    return slug.strip("-")


def find_volume_folder(source_path: Path, volume_num: int) -> Optional[Path]:
    if not source_path.exists():
        return None
    for entry in source_path.iterdir():
        if entry.is_dir():
            vol_num = extract_volume_number(entry.name)
            if vol_num == volume_num:
                return entry
    return None


def find_png_files(directory: Path) -> list[Path]:
    return sorted(directory.rglob("*.png"))


def convert_volume(
    source_path: Path, output_path: Path, volume_num: int, quality: int
) -> tuple[int, int]:
    png_files = find_png_files(source_path)
    if not png_files:
        raise ValueError(f"No PNG files found in {source_path}")

    volume_folder = output_path / f"volume-{pad_number(volume_num)}"
    volume_folder.mkdir(parents=True, exist_ok=True)

    converted = 0
    errors = 0

    for i, png_path in enumerate(png_files, 1):
        output_file = volume_folder / f"{pad_number(i)}.webp"
        try:
            with Image.open(png_path) as img:
                img.save(output_file, "WEBP", quality=quality, method=6)
            converted += 1
            console.print(f"Converting {png_path.name} → {output_file.name} ✅")
        except Exception as e:
            console.print(f"[red]Error converting {png_path}: {e}[/red]")
            errors += 1

    return converted, errors


# ============================================================================
# INTERACTIVE MENU HELPERS
# ============================================================================


def arrow_key_menu(options: list[str], title: str, default_index: int = 0) -> int:
    """Display an interactive menu with arrow key navigation.

    Returns the index of the selected option.
    """
    selected = default_index

    def render_menu():
        lines = [f"[bold blue]{title}[/bold blue]\n"]
        lines.append("[dim]Use ↑/↓ arrow keys to navigate, Enter to select[/dim]\n")

        for i, option in enumerate(options):
            if i == selected:
                lines.append(f"> [bold green]{option}[/bold green]")
            else:
                lines.append(f"  {option}")

        return Panel("\n".join(lines), border_style="blue")

    with Live(render_menu(), console=console, auto_refresh=False) as live:
        import sys
        import termios
        import tty

        # Save terminal settings
        old_settings = termios.tcgetattr(sys.stdin)

        try:
            # Set terminal to raw mode for single key input
            tty.setcbreak(sys.stdin.fileno())

            while True:
                live.update(render_menu())

                # Read single key
                key = sys.stdin.read(1)

                # Arrow keys start with escape sequence
                if key == "\x1b":
                    seq = sys.stdin.read(2)
                    if seq == "[A":  # Up arrow
                        selected = (selected - 1) % len(options)
                    elif seq == "[B":  # Down arrow
                        selected = (selected + 1) % len(options)
                elif key == "\n" or key == "\r":  # Enter
                    break
                elif key == "q":  # Quit
                    return -1

        finally:
            # Restore terminal settings
            termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_settings)

    return selected


def prompt_yes_no(question: str, default: bool = False) -> bool:
    """Ask a yes/no question."""
    default_str = "yes" if default else "no"
    response = (
        console.input(f"[bold]{question} (yes/no) [default: {default_str}]: [/bold]")
        .strip()
        .lower()
    )

    if not response:
        return default
    return response in ["yes", "y"]


def prompt_choice(question: str, options: list[str], default: str | None = None) -> str:
    """Ask user to choose from options."""
    options_str = "/".join(options)
    default_str = f" [default: {default}]" if default else ""

    while True:
        response = (
            console.input(f"[bold]{question} ({options_str}){default_str}: [/bold]")
            .strip()
            .lower()
        )

        if not response and default:
            return default

        if response in options:
            return response

        console.print(f"[red]Please enter one of: {options_str}[/red]")


# ============================================================================
# R2 BUCKET FUNCTIONS
# ============================================================================


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


def list_bucket_folders() -> list[str]:
    """List all manga folders in R2 bucket."""
    s3_client = get_r2_client()
    if not s3_client:
        return []

    bucket_name = os.getenv("R2_BUCKET_NAME", "manga")

    try:
        response = s3_client.list_objects_v2(
            Bucket=bucket_name, Prefix="manga/", Delimiter="/"
        )

        folders = []
        for prefix in response.get("CommonPrefixes", []):
            folder = prefix.get("Prefix", "")
            match = re.search(r"manga/([^/]+)/", folder)
            if match:
                folders.append(match.group(1))

        return sorted(folders)
    except Exception as e:
        console.print(f"[yellow]Warning: Could not list bucket folders: {e}[/yellow]")
        return []


def select_bucket_folder(default_slug: str) -> str:
    """Interactive bucket folder selection with arrow keys."""
    folders = list_bucket_folders()

    # Add default and new options
    all_options = folders.copy()

    if default_slug not in all_options:
        all_options.append(f"[Create new: {default_slug}]")
    else:
        # Move default to front and mark it
        all_options.remove(default_slug)
        all_options.insert(0, f"{default_slug} [default]")
        all_options.append("[Create new folder]")

    idx = arrow_key_menu(all_options, "Select R2 Bucket Folder")

    if idx == -1:
        console.print("[yellow]Cancelled by user.[/yellow]")
        raise typer.Exit(0)

    selected = all_options[idx]

    if "[Create new" in selected or "[Create new folder]" in selected:
        # Extract the default slug if it was in the create new text
        if default_slug in selected:
            return default_slug
        else:
            custom = console.input("[bold]Enter new folder name: [/bold]").strip()
            return custom or default_slug

    # Remove [default] marker if present
    return selected.replace(" [default]", "")


def upload_to_r2(
    webp_folder: Path, manga_slug: str, volume_num: int
) -> tuple[int, int]:
    """Upload WebP files to R2 bucket."""
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
            console.print(f"Uploading {webp_file.name} ✅")
        except Exception as e:
            console.print(f"[red]Error uploading {webp_file}: {e}[/red]")
            errors += 1

    return uploaded, errors


# ============================================================================
# CONVEX DATABASE FUNCTIONS
# ============================================================================


def get_manga_list() -> list[dict]:
    """Get list of manga with volume counts from Convex."""
    if not convex_client:
        return []

    try:
        return convex_client.query("manga:listMangaWithVolumeCounts")
    except Exception as e:
        console.print(f"[yellow]Warning: Could not fetch manga list: {e}[/yellow]")
        return []


def select_existing_manga() -> tuple[str | None, str | None]:
    """Interactive manga selection with arrow keys.

    Returns (manga_id, slug)
    """
    manga_list = get_manga_list()

    if not manga_list:
        console.print("[red]No existing manga found in database![/red]")
        return None, None

    # Format options
    options = []
    for manga in manga_list:
        title = manga.get("title", "Unknown")
        slug = manga.get("slug", "unknown")
        count = manga.get("volumeCount", 0)
        options.append(
            f"{title}\n   (slug: {slug}, {count} volume{'s' if count != 1 else ''})"
        )

    idx = arrow_key_menu(options, "Select Existing Manga to Append To")

    if idx == -1:
        console.print("[yellow]Cancelled by user.[/yellow]")
        return None, None

    selected = manga_list[idx]
    return selected.get("_id"), selected.get("slug")


def create_manga(title: str, slug: str, cover_url: str, total_volumes: int = 24) -> str:
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
                "status": "completed",
            },
        )
        manga_id = result if isinstance(result, str) else str(result)
        console.print(f"[green]Created manga with ID: {manga_id}[/green]")
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
        console.print(f"[green]Added volume with ID: {volume_id}[/green]")
        return volume_id
    except Exception as e:
        console.print(f"[red]Error adding volume: {e}[/red]")
        raise


# ============================================================================
# MAIN COMMAND
# ============================================================================


@app.command()
def main(
    volume: int = typer.Option(..., "--volume", "-v", help="Volume number to upload"),
    title: str = typer.Option(
        "JoJo's Bizarre Adventure Part 7: Steel Ball Run",
        "--title",
        "-t",
        help="Manga title",
    ),
    slug: Optional[str] = typer.Option(
        None,
        "--slug",
        "-s",
        help="Manga slug (auto-generated from title if not provided)",
    ),
    source: Optional[str] = typer.Option(
        None, "--source", help="Source directory (auto-detected if not provided)"
    ),
    output: Optional[str] = typer.Option(
        None, "--output", "-o", help="Output directory"
    ),
    quality: int = typer.Option(85, "--quality", "-q", help="WebP quality (1-100)"),
    skip_convert: bool = typer.Option(
        False, "--skip-convert", help="Skip PNG to WebP conversion"
    ),
):
    """Upload a manga volume to R2 and Convex"""

    # Generate slug if not provided
    if not slug:
        slug = generate_slug(title)

    console.print(
        Panel(
            Text.from_markup(
                f"[bold blue]Manga Upload Script[/bold blue]\n"
                f"Volume: {volume}\n"
                f"Title: {title}\n"
                f"Auto-generated slug: {slug}"
            ),
            title="Configuration",
            border_style="blue",
        )
    )

    # ============================================================================
    # STEP 1: Ask about bucket upload
    # ============================================================================
    console.print("\n[bold]Step 1: R2 Bucket Upload[/bold]")

    skip_bucket = prompt_yes_no(
        "Skip uploading to bucket and just upload to database?", default=False
    )

    selected_slug = slug

    if not skip_bucket:
        # Select bucket folder
        selected_slug = select_bucket_folder(slug)
        console.print(f"[green]Selected bucket folder: {selected_slug}[/green]")
    else:
        console.print("[blue]Skipping R2 bucket upload.[/blue]")

    # ============================================================================
    # STEP 2: File conversion (always needed for page count)
    # ============================================================================
    console.print("\n[bold]Step 2: File Processing[/bold]")

    source_base = (
        Path(source) if source else Path.home() / "Pictures/Manga/SteelBallRun/Volumes"
    )
    output_base = Path(output) if output else Path("./output") / selected_slug

    volume_folder = find_volume_folder(source_base, volume)
    if not volume_folder:
        console.print(f"[red]Volume {volume} folder not found in {source_base}[/red]")
        raise typer.Exit(1)

    console.print(f"[green]Found volume folder: {volume_folder}[/green]")

    page_count = 0

    if not skip_convert:
        console.print("\nConverting PNG to WebP...")
        converted, errors = convert_volume(volume_folder, output_base, volume, quality)
        page_count = converted
        console.print(f"[green]Converted {converted} pages ({errors} errors)[/green]")
    else:
        console.print("[yellow]Skipping conversion[/yellow]")
        volume_output = output_base / f"volume-{pad_number(volume)}"
        page_count = len(list(volume_output.glob("*.webp")))
        console.print(f"[blue]Found {page_count} existing WebP files[/blue]")

    # ============================================================================
    # STEP 3: R2 Upload (if not skipped)
    # ============================================================================
    if not skip_bucket:
        console.print("\n[bold]Step 3: Uploading to R2[/bold]")
        volume_output = output_base / f"volume-{pad_number(volume)}"
        uploaded, errors = upload_to_r2(volume_output, selected_slug, volume)
        console.print(f"[green]Uploaded {uploaded} files ({errors} errors)[/green]")

    # ============================================================================
    # STEP 4: Convex Database Upload
    # ============================================================================
    console.print("\n[bold]Step 4: Convex Database[/bold]")

    if not convex_client:
        console.print(
            "[red]Convex client not available. Skipping database update.[/red]"
        )
    else:
        # Ask: new manga or append to existing?
        choice = prompt_choice(
            "Create new manga or append to existing?",
            options=["new", "append"],
            default="append",
        )

        manga_id = None
        final_slug = selected_slug

        if choice == "append":
            # Select existing manga
            manga_id, final_slug = select_existing_manga()

            if manga_id is None:
                console.print(
                    "[yellow]No manga selected. Will create new instead.[/yellow]"
                )
                choice = "new"

        if choice == "new":
            # Create new manga
            console.print("\n[blue]Creating new manga record...[/blue]")
            cover_url = f"https://cdn.koushikkoushik.com/manga/{selected_slug}/volume-001/001.webp"
            manga_id = create_manga(title, selected_slug, cover_url)
            final_slug = selected_slug

        if manga_id:
            # Add volume
            console.print(f"\n[blue]Adding Volume {volume}...[/blue]")
            add_volume(manga_id, volume, page_count)
            console.print("[green]Convex database updated![/green]")
        else:
            console.print(
                "[red]Failed to get/create manga ID. Cannot add volume.[/red]"
            )

    # ============================================================================
    # FINAL SUMMARY
    # ============================================================================
    summary_text = (
        f"[bold green]Upload Complete![/bold green]\n\n"
        f"Volume: {volume}\n"
        f"Pages: {page_count}\n"
    )

    if not skip_bucket:
        summary_text += f"R2 Path: manga/{selected_slug}/volume-{pad_number(volume)}/\n"

    summary_text += f"\nFinal slug used: {selected_slug}"

    console.print(
        Panel(
            Text.from_markup(summary_text),
            title="Success",
            border_style="green",
        )
    )


if __name__ == "__main__":
    app()
