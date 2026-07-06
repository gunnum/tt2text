# Article Ingestion Rules

## Goal
Store article material as a self-contained bundle so an agent can read it without reopening the original page.

## Bundle Layout
- `raw.html`: full fetched source HTML
- `manifest.json`: structured metadata and content index
- `clean.md`: cleaned readable text in source order
- `assets/`: downloaded images
- `ocr/`: OCR or image-caption sidecars for each image

## Manifest Fields
- `schemaVersion`: fixed string, `tt2text.articleBundle.v1`
- `kind`: always `article`
- `sourceUrl`, `sourceName`, `sourceDomain`
- `title`, `subtitle`, `author`
- `publishedAt`, `modifiedAt`, `language`
- `keywords`, `section`, `wordCount`
- `fetchedAt`
- `files.rawHtml`, `files.cleanMarkdown`
- `images[]`
- `contentBlocks[]`
- `extractionNotes[]`
- `contentHash`

## Content Blocks
Store article text in order as blocks, not one giant blob.
- `heading1`, `heading2`, `heading3`
- `paragraph`
- `quote`
- `listItem`
- `image`
- `caption`

Each block should include at least:
- `id`
- `type`
- `text`

Optional image blocks should also carry:
- `imageId`
- `alt`
- `caption`
- `sourceUrl`
- `localPath`

## Images
Include every relevant image that appears inside the article body.
- Always include the primary cover image.
- Include content images embedded between paragraphs/headings.
- Skip navigation, related-story cards, ads, logos, cookie banners, and footer art.
- Save the original file locally.
- Add a sidecar OCR or caption file for each image.

## Clean Text Rules
- Preserve reading order.
- Remove navigation, ads, newsletter boilerplate, privacy boilerplate, and related-story modules.
- Keep pull quotes and figure captions.
- Keep links only as visible text unless they are semantically important.
- Stop before related-story sections when possible.

## Agent Expectations
An agent should be able to:
- read `manifest.json` and know the article structure
- read `clean.md` for a linear version
- inspect `assets/` and `ocr/` for visual details
- avoid visiting the source page again unless necessary
