"""Create metadata-stripped development derivatives and a labelled contact sheet.

The source files are eight public ``pic0.jpg`` images from:
Hwang et al., "Classification of pet dog skin diseases using deep learning
with images captured from multispectral imaging device",
https://doi.org/10.17632/5dbht54kw7.1 (CC BY 4.0).

These assets are development-only examples. They are not a diagnostic gold
standard. See the optional annotation guidance in
``evaluation/reference_data/annotation_guide.md``.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / "tmp" / "pilot_raw"
OUT_DIR = ROOT / "evaluation" / "pilot_public_images"

CASES = {
    "dog210422_04_02_33": "Fungal_infections",
    "dog210424_05_01_31": "Hypersensitivity_allergic_dermatosis",
    "dog210505_01_02_25": "Healthy",
    "dog210508_06_02_18": "Healthy",
    "dog210610_04_02_14": "Fungal_infections",
    "dog210612_03_01_13": "Bacterial_dermatosis",
    "dog210612_48_02_12": "Hypersensitivity_allergic_dermatosis",
    "dog210615_01_02_06": "Bacterial_dermatosis",
}

DERIVATIVE_SIZE = (1280, 720)
JPEG_QUALITY = 88


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    candidates = [
        Path(r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc"),
        Path(r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def build_derivatives() -> list[tuple[str, str, Path, Path]]:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    outputs: list[tuple[str, str, Path, Path]] = []

    for case_id, broad_label in CASES.items():
        source = RAW_DIR / f"{case_id}_pic0.jpg"
        target = OUT_DIR / f"{case_id}_dev.jpg"
        if not source.exists():
            raise FileNotFoundError(f"Missing expected source image: {source}")

        with Image.open(source) as opened:
            decoded = ImageOps.exif_transpose(opened).convert("RGB")
            derivative = decoded.resize(DERIVATIVE_SIZE, Image.Resampling.LANCZOS)
            # Omitting exif/icc/profile parameters deliberately strips metadata.
            derivative.save(
                target,
                format="JPEG",
                quality=JPEG_QUALITY,
                optimize=True,
                progressive=True,
                subsampling="4:2:0",
            )
        outputs.append((case_id, broad_label, source, target))

    return outputs


def build_contact_sheet(outputs: list[tuple[str, str, Path, Path]]) -> Path:
    columns = 2
    rows = 4
    tile_size = (600, 338)
    margin = 30
    gutter = 24
    header_height = 110
    label_height = 74
    footer_height = 96
    width = margin * 2 + columns * tile_size[0] + (columns - 1) * gutter
    height = (
        header_height
        + rows * (tile_size[1] + label_height)
        + (rows - 1) * gutter
        + footer_height
    )

    sheet = Image.new("RGB", (width, height), "#F7F8FA")
    draw = ImageDraw.Draw(sheet)
    draw.text(
        (margin, 22),
        "VetAI public pilot images — DEVELOPMENT ONLY / NOT A GOLD STANDARD",
        fill="#9A3412",
        font=font(26, bold=True),
    )
    draw.text(
        (margin, 63),
        "Broad source labels are retained for prompt-pipeline checks, not diagnostic accuracy claims.",
        fill="#374151",
        font=font(18),
    )

    for index, (case_id, broad_label, _source, target) in enumerate(outputs):
        row, col = divmod(index, columns)
        x = margin + col * (tile_size[0] + gutter)
        y = header_height + row * (tile_size[1] + label_height + gutter)
        with Image.open(target) as opened:
            tile = opened.resize(tile_size, Image.Resampling.LANCZOS)
            sheet.paste(tile, (x, y))
        draw.rounded_rectangle(
            (x, y + tile_size[1], x + tile_size[0], y + tile_size[1] + label_height),
            radius=8,
            fill="#FFFFFF",
            outline="#D1D5DB",
            width=1,
        )
        draw.text(
            (x + 14, y + tile_size[1] + 10),
            case_id,
            fill="#111827",
            font=font(17, bold=True),
        )
        draw.text(
            (x + 14, y + tile_size[1] + 39),
            broad_label,
            fill="#4B5563",
            font=font(15),
        )

    footer_y = height - footer_height + 14
    draw.text(
        (margin, footer_y),
        "Source: Hwang et al., Mendeley Data, DOI 10.17632/5dbht54kw7.1 · CC BY 4.0",
        fill="#374151",
        font=font(17),
    )
    draw.text(
        (margin, footer_y + 31),
        "Modifications: resized/compressed; metadata stripped. See manifest.csv for hashes and provenance.",
        fill="#6B7280",
        font=font(15),
    )

    target = OUT_DIR / "contact_sheet_dev_only.jpg"
    sheet.save(
        target,
        format="JPEG",
        quality=90,
        optimize=True,
        progressive=True,
        subsampling="4:2:0",
    )
    return target


def main() -> None:
    outputs = build_derivatives()
    contact_sheet = build_contact_sheet(outputs)
    for case_id, broad_label, source, target in outputs:
        print(
            "\t".join(
                [
                    case_id,
                    broad_label,
                    sha256(source),
                    sha256(target),
                    str(target),
                ]
            )
        )
    print(f"contact_sheet\t{sha256(contact_sheet)}\t{contact_sheet}")


if __name__ == "__main__":
    main()
