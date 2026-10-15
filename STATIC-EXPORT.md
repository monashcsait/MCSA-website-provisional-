# Temporary site English content and static export

The temporary site is fully static. Content changes require a new export and deployment.
General pages switch languages within the same HTML page. Only department pages have separate Chinese and English files.

1. Publish the Chinese content and review the English in the main CMS. Use **Approve and publish** for manual English edits.
2. Click **Export public content for the temporary site** and extract the ZIP. Do not use the content backup download.
3. For first-time setup, install Node.js 20+ and run these commands in the temporary site repository:

```powershell
cd "C:\Users\27396\MCSA-Web\MCSA-website-provisional-"

npm install
npx playwright install chromium
```

4. After installation succeeds, run the following commands one at a time. Replace the example path with your extracted `content.json`. If any command fails, stop and fix the error before continuing.

```powershell
npm run export -- --snapshot C:\exports\mcsa\content.json --out .export-review
$env:MCSA_EXPORT_DIR = '.export-review'
npm test
npm run test:browser
python -m http.server 8766 --directory .export-review
```

5. Open `http://127.0.0.1:8766/index.html?lang=en` to check the English content, then replace the deployed site with all files from `.export-review`.

- Use a new output directory for each export. Fix missing translations, missing images or broken links before retrying.
- Omit `--snapshot` to export the repository's `data/site.js` instead.
- Maintain separate Chinese and English department articles in `templates/departments/`. CMS department summaries do not overwrite them.
