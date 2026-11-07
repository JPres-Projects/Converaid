# Converaid application artwork

The Converaid mark was generated with the built-in image generation tool on November 6, 2026. The tool does not expose a selectable model version. The artwork is a cyan geometric conversation mark forming a C on a transparent background.

The selected generated output was `exec-78099db3-9a66-4338-8855-f95a7720d2df.png`. It is preserved without modification as `app/build/converaid-logo.png` (1254 by 1254 pixels, RGBA). Its SHA-256 is `09aebe7bfa6f12d9d621989955baf0fcf200681c87bf67dba484ac84c8afc299`.

## Generation prompts

Original generation prompt:

> Create one finished original logo mark for Converaid, a desktop assistant for clear conversation, interview practice and understanding software projects. This is the actual application icon, intended for a Windows taskbar and tray as well as the product brand. A single bold geometric emblem: two compact offset conversational forms interlock into an open C-like silhouette, with a distinctive clean negative-space opening suggesting an immediate helpful reply. Refined, confident, calm, precise; flat vector-like raster artwork with exceptionally crisp edges, strong simple silhouette and generous readable negative space. Use the sky-blue/cyan accent of the existing dark Converaid interface, with high contrast on both dark and light backgrounds. Emblem centered, balanced, about 80 percent of the square canvas; avoid hairlines and fine detail so the mark works at 16 and 32 pixels. Transparent background with true alpha. No wordmark, no text, no slogan, no microphone illustration, no stock AI sparkle, no circuit diagram, no mockup, no shadows, no gradient, no surrounding tile or border. Deliver one clean standalone production-ready mark, not a sheet of alternatives.

Edit prompt that produced the selected output:

> Polish this Converaid application logo into a finished precise vector-like icon. Preserve the same overall open C made from two conversational forms, its cyan/sky-blue color and its centered scale. Clean up all ragged edges, speckled cyan fringes, stray pixels and fuzzy paint-like residue, especially in the inner diagonal gap and around the outer contour. Every curve must be smooth and intentional, every corner crisp and consistent. Use solid flat cyan fill, no gradient, no lighting, no texture or shadow. Keep the inner negative space genuinely transparent. Preserve a transparent background with true alpha. Deliver only the single clean emblem, no text, no new shapes, no border or mockup. It should look like a professional app logo drawn as exact geometric vector paths and remain clear at 16 pixels.

## Application assets

The remaining assets use only technical resizing and format conversion with Windows .NET System.Drawing and high-quality bicubic interpolation:

- `app/build/converaid-icon.ico` contains 32-bit PNG frames at 16, 24, 32, 48, 64, 128, and 256 pixels.
- `app/build/converaid-tray-16.png`, `converaid-tray-32.png`, `converaid-tray-64.png`, and `converaid-tray-256.png` provide transparent tray sizes.
- `app/build/converaid-tray.png` is the 32-pixel tray asset used in development and copied to `resources/tray.png` when packaged.

Windows application builds use the ICO. macOS and Linux builds use the full-resolution PNG. Existing Meetingly artwork and installer artwork remain available. The package identity and application data location are unchanged so existing settings and stored credentials remain available.
