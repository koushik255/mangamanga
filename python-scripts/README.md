# Manga Uploader (Python + UV)

Python version of the manga upload scripts using UV for dependency management.

## Setup

### 1. Install UV (if not already installed)
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 2. Install dependencies
```bash
cd python-scripts
uv sync
```

### 3. Configure environment
```bash
cp .env.example .env
# Edit .env with your credentials
```

## Usage

### Upload a volume
```bash
# Basic usage (auto-detects from ~/Pictures/Manga/SteelBallRun/Volumes)
uv run upload_volume.py --volume 2

# With custom title
uv run upload_volume.py --volume 2 --title "My Manga Title"

# With specific slug
uv run upload_volume.py --volume 2 --title "My Manga" --slug "my-manga"

# Custom source directory
uv run upload_volume.py --volume 2 --source /path/to/volumes

# Custom output directory
uv run upload_volume.py --volume 2 --output ./my-output

# Skip conversion (use existing WebP files)
uv run upload_volume.py --volume 2 --skip-convert

# Skip R2 upload
uv run upload_volume.py --volume 2 --skip-r2

# Skip Convex update
uv run upload_volume.py --volume 2 --skip-convex

# Combined (only update Convex database)
uv run upload_volume.py --volume 2 --skip-convert --skip-r2
```

## Features

- **PNG to WebP conversion** using Pillow
- **R2 upload** with boto3 (S3-compatible)
- **Convex database updates** via npx CLI
- **Auto-detects** volume folders (e.g., "Steel Ball Run v02")
- **Smart manga creation** - checks if exists first, creates only if missing
- **Beautiful CLI output** with progress bars (Rich)
- **Same workflow** as the TypeScript scripts

## Dependencies

Managed by UV in `pyproject.toml`:
- `pillow` - Image processing
- `boto3` - AWS SDK for R2
- `python-dotenv` - Environment variables
- `rich` - Beautiful terminal output
- `typer` - Modern CLI framework

## Differences from TypeScript Version

1. **Language**: Python instead of Bun/TypeScript
2. **Package Manager**: UV instead of npm
3. **Image Library**: Pillow instead of Sharp
4. **AWS SDK**: boto3 instead of @aws-sdk/client-s3
5. **Convex**: Shells out to `npx convex` CLI instead of using JavaScript client
6. **CLI**: Typer for nicer CLI interface
7. **Output**: Rich for beautiful progress bars and panels

## Workflow

The script follows the exact same 3-step process:

1. **Convert**: PNG → WebP with quality setting
2. **Upload**: WebP files to R2 with cache headers
3. **Update**: Create manga (if needed) + add volume to Convex

## Error Handling

- Validates all required environment variables
- Checks if volume folder exists
- Reports conversion/upload errors per file
- Graceful handling of Convex CLI errors
- Continues processing on individual file errors
