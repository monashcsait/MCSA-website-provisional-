MCSA temporary website

Use scripts/export-static.cjs to generate the static website. See STATIC-EXPORT.md
for English review, public CMS export, checks and deployment instructions.
Upload only the export output directory to the static host. The site does not run
the backend; content changes require a new export and deployment.

Content maintenance
- General pages and published articles use one HTML file with a zh/en/hant language selector.
- Department names are fixed. Keep each department's Chinese and English articles separate in templates/departments; these pages are maintained independently of CMS department summaries.
- Department pages use static HTML and CSS without JavaScript or a content API. English files use the -en.html suffix; language links preserve the department.
- Edit templates before exporting, rather than editing generated HTML. Shared department styles are in assets/departments-static.css.
- content/english-review.json records English copy awaiting editorial review. Keep this checklist; it is excluded from public exports.
- --apply copies a verified export into this local checkout; it does not deploy the website.

Department source material
- Organisation content and original images came from official-website commit 3209a5e. Portraits, messages and article order are retained; the March 2026 recruitment round is closed.
- Secretariat uses the supplied 640–649 assets in order, including four leadership messages and the External, Internal and Information Technology teams. Its 24 July–10 August 2026 recruitment round and ten IT places are historical.
- Publicity retains the supplied photos, leader messages, three teams, requirements, benefits and past application notice. Its images 640–644 are separate from the Secretariat files; recruitment dates and account statistics are historical.
- content/departments/secretariat.json and publicity.json are content references, not browser data dependencies. If revised, update the corresponding Chinese and English templates together.
- Original images remain unchanged. The secretariat-originals.json and publicity-originals.json manifests in content/departments record checksums and sizes; export checks verify them.
- Department English copy still requires editorial review. Missing department history or leadership details remain pending.
