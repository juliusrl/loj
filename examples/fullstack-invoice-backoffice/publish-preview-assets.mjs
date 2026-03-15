import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const demoPackDir = path.join(__dirname, '.artifacts', 'demo-pack');
const summaryPath = path.join(demoPackDir, 'summary.json');
const previewDir = path.join(__dirname, '..', '..', 'docs', 'public-proof-assets', 'invoice-backoffice');

async function main() {
  const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
  const filesToCopy = new Set([
    ...summary.screenshots.map((entry) => entry.file),
    summary.motion?.file,
    ...(summary.motion?.derivatives ?? []).map((entry) => entry.file),
    'summary.json',
  ].filter(Boolean));

  await rm(previewDir, { recursive: true, force: true });
  await mkdir(previewDir, { recursive: true });

  for (const fileName of filesToCopy) {
    const source = path.join(demoPackDir, fileName);
    const destination = path.join(previewDir, fileName);
    await cp(source, destination);
  }

  const previewSummary = {
    sourceArtifactDir: path.relative(path.join(__dirname, '..', '..'), demoPackDir),
    publishedAt: new Date().toISOString(),
    projectFile: summary.projectFile,
    generatedAt: summary.generatedAt,
    screenshots: summary.screenshots,
    motion: summary.motion,
  };

  await writeFile(
    path.join(previewDir, 'preview-summary.json'),
    `${JSON.stringify(previewSummary, null, 2)}\n`,
    'utf8',
  );

  console.log(`Published public preview assets: ${previewDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
