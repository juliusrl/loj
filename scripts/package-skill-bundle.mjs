import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const rootPackageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
const version = rootPackageJson.version;
const skillName = 'loj-authoring';
const sourceDir = resolve(repoRoot, 'skills', skillName);
const outDir = resolve(repoRoot, '.artifacts', 'release-assets');
const archiveName = `${skillName}-${version}.tgz`;
const archivePath = resolve(outDir, archiveName);
const stagingRoot = resolve(repoRoot, '.artifacts', '.skill-bundle-staging');
const stagingParent = resolve(stagingRoot, skillName);

if (!existsSync(resolve(sourceDir, 'SKILL.md'))) {
  throw new Error(`Missing skill bundle source: ${sourceDir}`);
}

function writeOctal(buffer, offset, length, value) {
  const octal = value.toString(8).padStart(length - 1, '0');
  buffer.write(octal, offset, length - 1, 'ascii');
  buffer[offset + length - 1] = 0;
}

function writeString(buffer, offset, length, value) {
  buffer.write(value.slice(0, length), offset, 'utf8');
}

function splitName(fileName) {
  const normalized = fileName.replace(/\\/g, '/');
  if (Buffer.byteLength(normalized) <= 100) {
    return { name: normalized, prefix: '' };
  }
  const parts = normalized.split('/');
  let prefix = '';
  while (parts.length > 1) {
    const head = parts.shift();
    prefix = prefix ? `${prefix}/${head}` : head;
    const name = parts.join('/');
    if (Buffer.byteLength(name) <= 100 && Buffer.byteLength(prefix) <= 155) {
      return { name, prefix };
    }
  }
  throw new Error(`Tar entry path is too long: ${fileName}`);
}

function createTarHeader(fileName, stats, typeFlag) {
  const header = Buffer.alloc(512, 0);
  const { name, prefix } = splitName(fileName);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, typeFlag === '5' ? 0o755 : 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, typeFlag === '5' ? 0 : stats.size);
  writeOctal(header, 136, 12, Math.floor(stats.mtimeMs / 1000));
  header.fill(0x20, 148, 156);
  header.write(typeFlag, 156, 1, 'ascii');
  writeString(header, 257, 6, 'ustar');
  writeString(header, 263, 2, '00');
  writeString(header, 265, 32, 'loj');
  writeString(header, 297, 32, 'loj');
  writeString(header, 345, 155, prefix);
  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  const checksumField = checksum.toString(8).padStart(6, '0');
  writeString(header, 148, 6, checksumField);
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function collectTarEntries(rootDir) {
  const entries = [];
  function visit(dirPath) {
    const relativeDir = relative(rootDir, dirPath).replace(/\\/g, '/');
    if (relativeDir) {
      entries.push({
        fileName: `${relativeDir}/`,
        absolutePath: dirPath,
        isDirectory: true,
      });
    }
    const children = readdirSync(dirPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      const childPath = join(dirPath, child.name);
      const childRelative = relative(rootDir, childPath).replace(/\\/g, '/');
      if (child.isDirectory()) {
        visit(childPath);
      } else {
        entries.push({
          fileName: childRelative,
          absolutePath: childPath,
          isDirectory: false,
        });
      }
    }
  }
  visit(rootDir);
  return entries;
}

function buildTarBuffer(rootDir) {
  const chunks = [];
  for (const entry of collectTarEntries(rootDir)) {
    const stats = statSync(entry.absolutePath);
    const typeFlag = entry.isDirectory ? '5' : '0';
    chunks.push(createTarHeader(entry.fileName, stats, typeFlag));
    if (!entry.isDirectory) {
      const content = readFileSync(entry.absolutePath);
      chunks.push(content);
      const remainder = content.length % 512;
      if (remainder !== 0) {
        chunks.push(Buffer.alloc(512 - remainder, 0));
      }
    }
  }
  chunks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(chunks);
}

rmSync(stagingRoot, { recursive: true, force: true });
mkdirSync(stagingRoot, { recursive: true });
mkdirSync(outDir, { recursive: true });
cpSync(sourceDir, stagingParent, { recursive: true });

const tarBuffer = buildTarBuffer(stagingRoot);
writeFileSync(archivePath, gzipSync(tarBuffer));

rmSync(stagingRoot, { recursive: true, force: true });

console.log(`Packaged ${skillName} skill bundle`);
console.log(`source: ${sourceDir}`);
console.log(`archive: ${archivePath}`);
