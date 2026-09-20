import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

export const CAPABILITY_MANIFEST_FILE = 'graphframework.capability.json';
export const CAPABILITY_ASSEMBLY_FILE = 'assembly.mjs';

const CAPABILITY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

const FORBIDDEN_SEGMENTS = new Set(['node_modules', '.generated', '.git', '.hg', '.svn']);
const FORBIDDEN_BASENAMES = new Set([
  '.env', 'daemon-token', 'control-token', 'control.json', 'environment.sh',
  'run.lock.json', 'config-snapshot.json', 'close-result.json',
]);
const SKIPPED_BASENAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

const nativeImport = new Function('specifier', 'return import(specifier)');
let verifySequence = 0;

/** Deterministic stored-only ZIP writer: no dependency, stable SHA-256. */
export function createZip(entries) {
  const files = entries.map((entry) => {
    const name = entry.name;
    assertZipName(name);
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data ?? ''), 'utf8');
    return { name, data };
  });
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  // DOS timestamp fixed at 2020-01-01 so repeated packs hash identically.
  const dosTime = 0;
  const dosDate = ((2020 - 1980) << 9) | (1 << 5) | 1;
  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const checksum = crc32Of(file.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(dosTime, 10);
    header.writeUInt16LE(dosDate, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(file.data.length, 18);
    header.writeUInt32LE(file.data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28);
    chunks.push(header, Buffer.from(nameBytes), file.data);
    central.push({ nameBytes, checksum, size: file.data.length, offset });
    offset += 30 + nameBytes.length + file.data.length;
  }
  const centralOffset = offset;
  let centralSize = 0;
  for (const item of central) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(dosTime, 12);
    header.writeUInt16LE(dosDate, 14);
    header.writeUInt32LE(item.checksum, 16);
    header.writeUInt32LE(item.size, 20);
    header.writeUInt32LE(item.size, 24);
    header.writeUInt16LE(item.nameBytes.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(item.offset, 42);
    chunks.push(header, Buffer.from(item.nameBytes));
    centralSize += 46 + item.nameBytes.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  chunks.push(end);
  return Buffer.concat(chunks);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();

function crc32Of(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function assertZipName(name) {
  if (typeof name !== 'string' || !name) throw new Error(`Invalid zip entry: ${JSON.stringify(name)}`);
  if (name.includes('\\') || isAbsolute(name) || /^[A-Za-z]:/.test(name)) {
    throw new Error(`Zip entry must be a relative forward-slash path: ${name}`);
  }
  for (const segment of name.split('/')) {
    if (!segment || segment === '.' || segment === '..') throw new Error(`Zip entry escapes its directory: ${name}`);
  }
}

/** Minimal ZIP reader: stored + deflate entries, enough to verify and install foreign zips. */
export function parseZipEntries(buffer) {
  if (buffer.length < 22) throw new Error('Not a zip archive: too small');
  let eocd = -1;
  const floor = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= floor; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip archive: end of central directory not found');
  const count = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  let cursor = centralOffset;
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Not a zip archive: corrupt central directory');
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const csize = buffer.readUInt32LE(cursor + 20);
    const usize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    entries.push({ name, method, crc, csize, usize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function extractZipEntry(buffer, entry) {
  assertZipName(entry.name);
  if (buffer.readUInt32LE(entry.localOffset) !== 0x04034b50) {
    throw new Error(`Corrupt zip local header: ${entry.name}`);
  }
  const nameLength = buffer.readUInt16LE(entry.localOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const raw = buffer.subarray(start, start + entry.csize);
  const data = entry.method === 0 ? Buffer.from(raw)
    : entry.method === 8 ? inflateRawSync(raw)
      : (() => { throw new Error(`Unsupported zip method ${entry.method}: ${entry.name}`); })();
  if (data.length !== entry.usize) throw new Error(`Zip size mismatch: ${entry.name}`);
  if (crc32Of(data) !== entry.crc) throw new Error(`Zip checksum mismatch: ${entry.name}`);
  return data;
}

export function sha256OfFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function readCapabilityManifestFile(directory) {
  const path = join(directory, CAPABILITY_MANIFEST_FILE);
  if (!existsSync(path)) throw new Error(`Capability manifest not found: ${path}`);
  return readCapabilityManifest(JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')), path);
}

export function readCapabilityManifest(value, label = 'capability manifest') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!['id', 'version', 'minFrameworkVersion', 'summary', 'workflow'].includes(key)) {
      throw new Error(`${label} has unknown field: ${key}`);
    }
  }
  if (typeof value.id !== 'string' || !CAPABILITY_ID.test(value.id)) {
    throw new Error(`${label}.id must match ${CAPABILITY_ID}, got ${JSON.stringify(value.id)}`);
  }
  if (typeof value.version !== 'string' || !SEMVER.test(value.version)) {
    throw new Error(`${label}.version must be semver, got ${JSON.stringify(value.version)}`);
  }
  return {
    id: value.id,
    version: value.version,
    ...(value.minFrameworkVersion === undefined ? {} : { minFrameworkVersion: String(value.minFrameworkVersion) }),
    ...(value.summary === undefined ? {} : { summary: String(value.summary) }),
    ...(value.workflow === undefined ? {} : { workflow: String(value.workflow) }),
  };
}

function assertInsideStaging(stagingDir, candidate, label) {
  const target = resolve(stagingDir, candidate);
  const rel = relative(stagingDir, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`${label} escapes the capability directory: ${candidate}`);
  }
  return target;
}

/** Collects packable files; forbidden entries fail loudly instead of being silently dropped. */
export function collectCapabilityFiles(sourceDir) {
  const root = resolve(sourceDir);
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Capability source is not a directory: ${sourceDir}`);
  }
  const collected = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(current, entry.name);
      const rel = relative(root, absolute).split(sep).join('/');
      if (SKIPPED_BASENAMES.has(entry.name)) continue;
      for (const segment of rel.split('/')) {
        if (FORBIDDEN_SEGMENTS.has(segment)) {
          throw new Error(`Capability must not contain ${segment}: ${rel}`);
        }
      }
      if (FORBIDDEN_BASENAMES.has(entry.name)) {
        throw new Error(`Capability must not contain credentials or run state: ${rel}`);
      }
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) collected.push({ name: rel, absolute });
    }
  };
  walk(root);
  return collected;
}

/**
 * Validates an extracted (or source) capability directory: manifest, assembly
 * contribution, plugin references and factory names. Shared by pack (pre-zip)
 * and verify (post-extract) so both sides enforce the same contract.
 */
export async function verifyStagingDirectory(stagingDir, { zipBasename = null } = {}) {
  const errors = [];
  const warnings = [];
  const root = resolve(stagingDir);
  let manifest = null;
  try {
    manifest = readCapabilityManifestFile(root);
  } catch (error) { errors.push(error.message); }
  if (!existsSync(join(root, CAPABILITY_ASSEMBLY_FILE))) {
    errors.push(`Capability is missing ${CAPABILITY_ASSEMBLY_FILE}`);
  }
  if (!statSync(join(root, 'plugins'), { throwIfNoEntry: false })?.isDirectory()) {
    errors.push('Capability is missing plugins/');
  }
  if (zipBasename && manifest && basename(zipBasename) !== `${manifest.id}-${manifest.version}.zip`) {
    errors.push(`Zip name must be ${manifest.id}-${manifest.version}.zip, got ${basename(zipBasename)}`);
  }
  let contributionId = null;
  const plugins = [];
  const nodes = [];
  const requiredNodeIds = [];
  if (manifest && existsSync(join(root, CAPABILITY_ASSEMBLY_FILE))) {
    try {
      const contribution = await loadContribution(join(root, CAPABILITY_ASSEMBLY_FILE));
      contributionId = contribution.id;
      if (contribution.id !== manifest.id) {
        errors.push(`Assembly contribution id ${contribution.id} does not match capability ${manifest.id}`);
      }
      const facts = collectContributionFacts(contribution, root);
      requiredNodeIds.push(...facts.requiredNodeIds);
      const checkedPlugins = [];
      for (const plugin of facts.backendPlugins) {
        const checked = { ...plugin, kind: 'backend' };
        plugins.push(checked);
        try {
          checkedPlugins.push(checkPackagedPlugin(root, checked, warnings));
        } catch (error) { errors.push(error.message); }
      }
      for (const plugin of facts.frontendPlugins) {
        const checked = { ...plugin, kind: 'frontend' };
        plugins.push(checked);
        try {
          checkedPlugins.push(checkPackagedPlugin(root, checked, warnings));
        } catch (error) { errors.push(error.message); }
      }
      const byId = new Map(checkedPlugins.map((plugin) => [plugin.id, plugin]));
      for (const node of [...facts.nodes, ...facts.graphs]) {
        nodes.push(node);
        const owner = byId.get(node.plugin);
        if (!owner) {
          warnings.push(`Instance ${node.id} references external plugin ${node.plugin}; the receiving run must provide it`);
          continue;
        }
        const factoryField = node.kind === 'node' ? 'nodeFactories' : 'graphFactories';
        const names = owner.factories[factoryField] ?? [];
        if (!names.includes(node.factory)) {
          errors.push(`Factory ${node.plugin}/${node.factory} is not exported in the packaged manifest`);
        }
      }
      for (const frontend of facts.frontends) {
        if (!facts.frontendPlugins.some((plugin) => plugin.id === frontend.plugin)) {
          warnings.push(`Frontend ${frontend.id} references external plugin ${frontend.plugin}; the receiving run must provide it`);
        }
      }
    } catch (error) { errors.push(error.message); }
  }
  return { errors, warnings, manifest, contributionId, plugins, nodes, requiredNodeIds };
}

async function loadContribution(assemblyPath) {
  verifySequence += 1;
  const url = `${pathToFileURL(assemblyPath).href}?capability-verify=${verifySequence}`;
  const loaded = await nativeImport(url);
  const contribution = loaded.default ?? loaded.contribution;
  if (!contribution || typeof contribution !== 'object' || Array.isArray(contribution)) {
    throw new Error(`Assembly must export a contribution object: ${assemblyPath}`);
  }
  if (typeof contribution.id !== 'string' || !contribution.id) {
    throw new Error(`Assembly contribution requires an id: ${assemblyPath}`);
  }
  if (typeof contribution.contribute !== 'function') {
    throw new Error(`Assembly contribution ${contribution.id} requires contribute(run)`);
  }
  return contribution;
}

function collectContributionFacts(contribution, stagingDir) {
  const backendPlugins = [];
  const frontendPlugins = [];
  const nodes = [];
  const graphs = [];
  const frontends = [];
  const requiredNodeIds = [];
  const run = Object.freeze({
    backendPlugin: (entry) => backendPlugins.push(checkShape(entry, ['id', 'path'], 'backendPlugin')),
    frontendPlugin: (entry) => frontendPlugins.push(checkShape(entry, ['id', 'path'], 'frontendPlugin')),
    node: (entry) => nodes.push({ ...checkShape(entry, ['id', 'plugin', 'factory'], 'node'), kind: 'node' }),
    graph: (entry) => graphs.push({ ...checkShape(entry, ['id', 'plugin', 'factory'], 'graph'), kind: 'graph' }),
    frontend: (entry) => frontends.push(checkShape(entry, ['id', 'plugin'], 'frontend')),
    requireNode: (nodeId) => {
      if (typeof nodeId !== 'string' || !nodeId) throw new Error(`${contribution.id} requireNode requires a Node ID`);
      requiredNodeIds.push(nodeId);
    },
  });
  const outcome = contribution.contribute(run);
  if (outcome && typeof outcome.then === 'function') {
    throw new Error(`Assembly contribution ${contribution.id} must be synchronous`);
  }
  for (const plugin of [...backendPlugins, ...frontendPlugins]) {
    assertInsideStaging(stagingDir, plugin.path, `${contribution.id} plugin path`);
  }
  return { backendPlugins, frontendPlugins, nodes, graphs, frontends, requiredNodeIds };
}

function checkShape(entry, fields, label) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`Assembly ${label} requires an object`);
  }
  for (const field of fields) {
    if (typeof entry[field] !== 'string' || !entry[field]) {
      throw new Error(`Assembly ${label}.${field} must be a nonempty string`);
    }
  }
  return { ...entry };
}

function checkPackagedPlugin(stagingDir, plugin, warnings) {
  const directory = assertInsideStaging(stagingDir, plugin.path, 'plugin path');
  const manifestPath = join(directory, 'graphframework.plugin.json');
  if (!existsSync(manifestPath)) throw new Error(`Packaged plugin is missing its manifest: ${plugin.path}`);
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
  if (raw.id !== plugin.id) throw new Error(`Plugin identity mismatch: ${plugin.id} (manifest says ${raw.id})`);
  if (raw.apiVersion !== 2) throw new Error(`Plugin ${plugin.id} apiVersion must be 2 for capability sharing`);
  const kind = plugin.kind ?? 'backend';
  if (raw.kind !== kind) throw new Error(`Plugin ${plugin.id} kind must be ${kind}`);
  if (kind === 'backend') {
    const entry = raw.contributes?.backend;
    if (typeof entry !== 'string' || !entry) throw new Error(`Plugin has no backend entry: ${plugin.id}`);
    const target = resolve(directory, entry);
    if (relative(directory, target) === '..' || relative(directory, target).startsWith(`..${sep}`)) {
      throw new Error(`Plugin entry escapes its plugin: ${plugin.id}`);
    }
    if (!existsSync(target)) throw new Error(`Plugin backend entry is missing: ${plugin.id} -> ${entry}`);
  }
  const factories = {
    nodeFactories: raw.contributes?.nodeFactories ?? [],
    graphFactories: raw.contributes?.graphFactories ?? [],
  };
  if (!existsSync(join(directory, 'PACKAGE.md'))) {
    warnings.push(`Plugin ${plugin.id} is missing PACKAGE.md (required for formal delivery)`);
  } else {
    const text = readFileSync(join(directory, 'PACKAGE.md'), 'utf8');
    const packageId = text.match(/^package_id:\s*(.+)$/m)?.[1]?.trim();
    const packageVersion = text.match(/^package_version:\s*(.+)$/m)?.[1]?.trim();
    if (packageId && packageId !== plugin.id) warnings.push(`PACKAGE.md package_id ${packageId} does not match ${plugin.id}`);
    if (packageVersion && raw.version && packageVersion !== String(raw.version)) {
      warnings.push(`PACKAGE.md package_version ${packageVersion} does not match manifest ${raw.version}`);
    }
  }
  if (!existsSync(join(directory, 'docs', 'INTEGRATION.md'))) {
    warnings.push(`Plugin ${plugin.id} is missing docs/INTEGRATION.md`);
  }
  return { ...plugin, kind, directory, factories };
}

/** Publisher side: compress a capability directory into a versioned zip + sha256 sidecar. */
export async function packCapability(sourceDir, outPath) {
  const root = resolve(sourceDir);
  const manifest = readCapabilityManifestFile(root);
  const files = collectCapabilityFiles(root);
  if (!files.some((file) => file.name === CAPABILITY_ASSEMBLY_FILE)) {
    throw new Error(`Capability is missing ${CAPABILITY_ASSEMBLY_FILE}`);
  }
  const staging = await verifyStagingDirectory(root);
  if (staging.errors.length > 0) {
    throw new Error(`Capability is not shareable:\n- ${staging.errors.join('\n- ')}`);
  }
  const entries = files.map((file) => ({ name: `${manifest.id}/${file.name}`, data: readFileSync(file.absolute) }));
  const buffer = createZip(entries);
  let zipPath = outPath ? resolve(outPath) : join(process.cwd(), `${manifest.id}-${manifest.version}.zip`);
  if (existsSync(zipPath) && statSync(zipPath).isDirectory()) {
    zipPath = join(zipPath, `${manifest.id}-${manifest.version}.zip`);
  }
  if (basename(zipPath) !== `${manifest.id}-${manifest.version}.zip`) {
    throw new Error(`Zip name must be ${manifest.id}-${manifest.version}.zip, got ${basename(zipPath)}`);
  }
  mkdirSync(dirname(zipPath), { recursive: true });
  writeFileSync(zipPath, buffer);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  writeFileSync(`${zipPath}.sha256`, `${sha256}  ${basename(zipPath)}\n`);
  return {
    zip: zipPath, sha256, capability: manifest, files: entries.length, size: buffer.length,
    contributionId: staging.contributionId, warnings: staging.warnings,
  };
}

/** Receiver side: verify publisher, filename, shape, references and summary without trusting the chat message. */
export async function verifyCapability(zipPath, { expectSha256 = null } = {}) {
  const resolved = resolve(zipPath);
  if (!existsSync(resolved)) throw new Error(`Capability zip not found: ${zipPath}`);
  const errors = [];
  const warnings = [];
  const sha256 = sha256OfFile(resolved);
  if (expectSha256 && expectSha256.toLowerCase() !== sha256.toLowerCase()) {
    errors.push(`SHA-256 mismatch: expected ${expectSha256}, got ${sha256}`);
  }
  const buffer = readFileSync(resolved);
  let entries = [];
  try {
    entries = parseZipEntries(buffer);
  } catch (error) { errors.push(error.message); }
  if (entries.length === 0 && errors.length === 0) errors.push('Capability zip is empty');
  const tops = new Set(entries.map((entry) => entry.name.split('/')[0]));
  if (tops.size !== 1) errors.push(`Capability zip must hold one top directory, got ${[...tops].join(', ')}`);
  for (const entry of entries) {
    try {
      assertZipName(entry.name);
    } catch (error) { errors.push(error.message); continue; }
    for (const segment of entry.name.split('/')) {
      if (FORBIDDEN_SEGMENTS.has(segment)) errors.push(`Capability must not contain ${segment}: ${entry.name}`);
    }
    if (FORBIDDEN_BASENAMES.has(basename(entry.name))) {
      errors.push(`Capability must not contain credentials or run state: ${entry.name}`);
    }
  }
  let detail = { errors: [], warnings: [], manifest: null, contributionId: null, plugins: [], nodes: [], requiredNodeIds: [] };
  if (errors.length === 0) {
    const staging = mkdtempSync(join(tmpdir(), 'gv-cap-verify-'));
    try {
      for (const entry of entries) {
        if (entry.name.endsWith('/')) continue;
        const target = join(staging, entry.name);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, extractZipEntry(buffer, entry));
      }
      const top = join(staging, [...tops][0]);
      detail = await verifyStagingDirectory(top, { zipBasename: resolved });
      errors.push(...detail.errors);
      warnings.push(...detail.warnings);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }
  return {
    ok: errors.length === 0, zip: resolved, sha256, errors, warnings,
    capability: detail.manifest, contributionId: detail.contributionId,
    files: entries.length, plugins: detail.plugins.map((plugin) => `${plugin.kind ?? 'backend'}:${plugin.id}`),
    nodes: detail.nodes.map((node) => `${node.kind ?? 'node'}:${node.id}@${node.plugin}/${node.factory}`), requiredNodeIds: detail.requiredNodeIds,
  };
}

/**
 * Installs a verified capability next to a run: extract to a managed directory,
 * then add (first install) or keep (update) the single assembly.modules entry.
 */
export async function installCapability(zipPath, { dir = null, runConfigPath = null, update = false, expectSha256 = null } = {}) {
  const report = await verifyCapability(zipPath, { expectSha256 });
  if (!report.ok) {
    throw new Error(`Refusing to install an unverifiable capability:\n- ${report.errors.join('\n- ')}`);
  }
  const { id } = report.capability;
  let capabilitiesDir = dir ? resolve(dir) : null;
  let runDir = null;
  if (runConfigPath) {
    const configPath = resolve(runConfigPath);
    if (!existsSync(configPath)) throw new Error(`Run config not found: ${runConfigPath}`);
    runDir = dirname(configPath);
    capabilitiesDir ??= join(runDir, 'capabilities');
  }
  capabilitiesDir ??= join(process.cwd(), 'capabilities');
  const target = join(capabilitiesDir, id);
  if (existsSync(target) && !update) {
    throw new Error(`Capability ${id} is already installed at ${target}; pass --update to replace it in place`);
  }
  let assemblyModule = null;
  let candidateModules = null;
  if (runDir) {
    const configPath = join(runDir, 'run.config.json');
    const document = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
    const staging = mkdtempSync(join(tmpdir(), 'gv-cap-probe-'));
    const bufferProbe = readFileSync(resolve(zipPath));
    const entriesProbe = parseZipEntries(bufferProbe);
    for (const entry of entriesProbe) {
      if (entry.name.endsWith('/')) continue;
      const targetFile = join(staging, entry.name.slice(id.length + 1));
      mkdirSync(dirname(targetFile), { recursive: true });
      writeFileSync(targetFile, extractZipEntry(bufferProbe, entry));
    }
    try {
      const { parseRunConfig } = await import('./config.mjs');
      const { resolveDaemonBinary } = await import('./session.mjs');
      const { resolveRunAssembly } = await import('./assembly.mjs');
      assemblyModule = relative(runDir, join(capabilitiesDir, id, CAPABILITY_ASSEMBLY_FILE)).split(sep).join('/');
      const modules = Array.isArray(document.assembly?.modules) ? [...document.assembly.modules] : [];
      if (!modules.includes(assemblyModule)) modules.push(assemblyModule);
      candidateModules = modules;
      const parsed = parseRunConfig(
        { ...document, assembly: { ...(document.assembly ?? {}), modules } },
        { configPath: resolve(configPath), baseDirectory: runDir },
      );
      const probedModules = parsed.assembly.modules.map((modulePath, index) => (
        modules[index] === assemblyModule ? join(staging, CAPABILITY_ASSEMBLY_FILE) : modulePath
      ));
      const probed = await resolveRunAssembly({ ...parsed, assembly: { ...parsed.assembly, modules: probedModules } });
      await checkInstalledCapabilityDrift({ capabilitiesDir, capabilityId: id, staging, zipFacts: null, probed });
      resolveDaemonBinary(parsed);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }
  const buffer = readFileSync(resolve(zipPath));
  const entries = parseZipEntries(buffer);
  const staging = mkdtempSync(join(tmpdir(), 'gv-cap-install-'));
  try {
    for (const entry of entries) {
      if (entry.name.endsWith('/')) continue;
      const rel = entry.name.slice(id.length + 1);
      const targetFile = join(staging, rel);
      mkdirSync(dirname(targetFile), { recursive: true });
      writeFileSync(targetFile, extractZipEntry(buffer, entry));
    }
    mkdirSync(capabilitiesDir, { recursive: true });
    if (existsSync(target)) rmSync(target, { recursive: true });
    renameSync(staging, target);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  if (runDir && candidateModules) {
    const configPath = join(runDir, 'run.config.json');
    const document = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
    document.assembly = { ...(document.assembly ?? {}), modules: candidateModules };
    writeFileSync(configPath, `${JSON.stringify(document, null, 2)}\n`);
    assemblyModule = relative(runDir, join(target, CAPABILITY_ASSEMBLY_FILE)).split(sep).join('/');
  }
  return {
    installed: target, capability: report.capability, sha256: report.sha256,
    assemblyModule, warnings: report.warnings, updated: Boolean(update),
  };
}

/**
 * Detects local drift of an installed capability before install --update or a
 * conflicting reinstall replaces it: the on-disk contribution facts and each
 * packaged manifest must still match the verified zip. Otherwise install
 * would silently bless a local edit and hide the real conflict.
 */
async function checkInstalledCapabilityDrift({ capabilitiesDir, capabilityId, staging, probed }) {
  void probed;
  const installedDir = join(capabilitiesDir, capabilityId);
  if (!existsSync(join(installedDir, CAPABILITY_ASSEMBLY_FILE))) return;
  const zipFacts = collectContributionFacts(await loadContribution(join(staging, CAPABILITY_ASSEMBLY_FILE)), staging);
  const installedFacts = collectContributionFacts(await loadContribution(join(installedDir, CAPABILITY_ASSEMBLY_FILE)), installedDir);
  const zipPlugins = new Map([...zipFacts.backendPlugins, ...zipFacts.frontendPlugins].map((plugin) => [plugin.id, plugin]));
  const installedPlugins = new Map([...installedFacts.backendPlugins, ...installedFacts.frontendPlugins].map((plugin) => [plugin.id, plugin]));
  const drifted = [];
  for (const [pluginId, zipPlugin] of zipPlugins) {
    const installed = installedPlugins.get(pluginId);
    if (!installed) {
      drifted.push(`plugin ${pluginId} is missing locally`);
      continue;
    }
    const zipManifest = JSON.parse(readFileSync(join(staging, zipPlugin.path, 'graphframework.plugin.json'), 'utf8').replace(/^\uFEFF/, ''));
    const installedManifest = JSON.parse(readFileSync(join(installedDir, installed.path, 'graphframework.plugin.json'), 'utf8').replace(/^\uFEFF/, ''));
    if (JSON.stringify(zipManifest) !== JSON.stringify(installedManifest)) {
      drifted.push(`plugin ${pluginId} manifest drifted locally`);
    }
  }
  const zipNodes = new Map([...zipFacts.nodes, ...zipFacts.graphs].map((node) => [node.id, node]));
  const installedNodes = new Map([...installedFacts.nodes, ...installedFacts.graphs].map((node) => [node.id, node]));
  for (const [nodeId, zipNode] of zipNodes) {
    if (!installedNodes.has(nodeId)) drifted.push(`node ${nodeId} is missing locally`);
    else if (JSON.stringify(zipNode) !== JSON.stringify(installedNodes.get(nodeId))) drifted.push(`node ${nodeId} drifted locally`);
  }
  for (const nodeId of installedNodes.keys()) {
    if (!zipNodes.has(nodeId)) drifted.push(`node ${nodeId} was added locally`);
  }
  if (drifted.length > 0) {
    throw new Error(`Installed capability ${capabilityId} has local edits; resolve them before reinstalling:\n- ${drifted.join('\n- ')}`);
  }
}

/**
 * Packs the base software: packages/ (with precompiled kernel daemon), DOCUMENTS/, app/ (core plugins only), run.sh, README.md.
 * Strictly excludes: runs/*, non-core plugins (such as browser-recorder/os-recorder), AGENTS.md, .agents, .omp, node_modules, .generated, etc.
 */
export async function packBaseSoftware(repoRoot, outPath) {
  const root = resolve(repoRoot);
  const corePluginBasenames = new Set(['demo-topology', 'hello-counter']);
  const collected = [];

  const walk = (current, relPrefix = '') => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(current, entry.name);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      // Strictly skip package directories, virtualenvs, caches, and build targets
      if (
        entry.name === 'node_modules' ||
        entry.name === 'target' ||
        entry.name === '.git' ||
        entry.name === '.generated' ||
        entry.name === '.agents' ||
        entry.name === '.omp' ||
        entry.name === '.venv' ||
        entry.name === 'venv' ||
        entry.name === '__pycache__' ||
        entry.name.endsWith('.egg-info') ||
        entry.name.endsWith('.dist-info')
      ) continue;

      // Strictly skip installable package files and compiled artifacts
      const ext = extname(entry.name).toLowerCase();
      if (
        ext === '.tgz' ||
        ext === '.whl' ||
        ext === '.egg' ||
        ext === '.crate' ||
        ext === '.pyc' ||
        ext === '.pyo' ||
        ext === '.pyd' ||
        ext === '.rlib' ||
        ext === '.rmeta' ||
        ext === '.pdb'
      ) continue;

      // Filter app/plugins: only include core plugins!
      if (rel.startsWith('app/plugins/backend/') || rel.startsWith('app/plugins/frontend/')) {
        const parts = rel.split('/');
        const pluginName = parts[3];
        if (pluginName && !corePluginBasenames.has(pluginName)) {
          continue; // skip non-core plugins!
        }
      }

      if (entry.isDirectory()) {
        walk(absolute, rel);
      } else if (entry.isFile()) {
        collected.push({ name: rel, absolute });
      }
    }
  };

  // 1. packages/
  walk(join(root, 'packages'), 'packages');
  // 2. DOCUMENTS/
  walk(join(root, 'DOCUMENTS'), 'DOCUMENTS');
  // 3. app/
  walk(join(root, 'app'), 'app');
  // 4. Root files
  for (const rootFile of ['run.sh', 'README.md']) {
    const abs = join(root, rootFile);
    if (existsSync(abs)) collected.push({ name: rootFile, absolute: abs });
  }

  const entries = collected.map((file) => ({ name: file.name, data: readFileSync(file.absolute) }));
  const buffer = createZip(entries);
  let zipPath = outPath ? resolve(outPath) : join(process.cwd(), 'graphframework-base-1.0.0.zip');
  if (existsSync(zipPath) && statSync(zipPath, { throwIfNoEntry: false })?.isDirectory()) {
    zipPath = join(zipPath, 'graphframework-base-1.0.0.zip');
  }
  mkdirSync(dirname(zipPath), { recursive: true });
  writeFileSync(zipPath, buffer);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  writeFileSync(`${zipPath}.sha256`, `${sha256}  ${basename(zipPath)}\n`);
  return {
    zip: zipPath, sha256, files: entries.length, size: buffer.length,
  };
}

/**
 * Extracts a base software zip into target directory.
 */
export async function installBaseSoftware(zipPath, targetDir) {
  const target = resolve(targetDir);
  const buffer = readFileSync(resolve(zipPath));
  const entries = parseZipEntries(buffer);
  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue;
    const dest = join(target, entry.name);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, extractZipEntry(buffer, entry));
  }
  return { installed: target, files: entries.length };
}

/**
 * Packs a run: run.config.json, assembly.mjs, scripts, plugins/ and tests/ under that run.
 */
export async function packRun(runDir, outPath) {
  const root = resolve(runDir);
  const configPath = join(root, 'run.config.json');
  if (!existsSync(configPath)) throw new Error(`Run config not found: ${configPath}`);
  const doc = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
  const runName = doc.name || basename(root);

  const collected = [];
  const walk = (current, relPrefix = '') => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(current, entry.name);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (SKIPPED_BASENAMES.has(entry.name) || entry.name === '.generated' || entry.name === 'run.lock.json' || entry.name === 'node_modules') continue;
      if (entry.isDirectory()) walk(absolute, rel);
      else if (entry.isFile()) collected.push({ name: rel, absolute });
    }
  };
  walk(root);

  const entries = collected.map((file) => ({ name: `${runName}/${file.name}`, data: readFileSync(file.absolute) }));
  const buffer = createZip(entries);
  let zipPath = outPath ? resolve(outPath) : join(process.cwd(), `run-${runName}.zip`);
  if (existsSync(zipPath) && statSync(zipPath, { throwIfNoEntry: false })?.isDirectory()) {
    zipPath = join(zipPath, `run-${runName}.zip`);
  }
  mkdirSync(dirname(zipPath), { recursive: true });
  writeFileSync(zipPath, buffer);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  writeFileSync(`${zipPath}.sha256`, `${sha256}  ${basename(zipPath)}\n`);
  return {
    zip: zipPath, sha256, runName, files: entries.length, size: buffer.length,
  };
}

/**
 * Installs a run zip into targetBaseDir/runs/<runName>.
 */
export async function installRun(zipPath, targetBaseDir) {
  const base = resolve(targetBaseDir);
  const buffer = readFileSync(resolve(zipPath));
  const entries = parseZipEntries(buffer);
  const tops = new Set(entries.map((entry) => entry.name.split('/')[0]));
  if (tops.size !== 1) throw new Error(`Run zip must have 1 top directory, got: ${[...tops].join(', ')}`);
  const runName = [...tops][0];
  const targetRunDir = join(base, 'runs', runName);
  mkdirSync(targetRunDir, { recursive: true });

  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue;
    const rel = entry.name.slice(runName.length + 1);
    const dest = join(targetRunDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, extractZipEntry(buffer, entry));
  }
  return { installed: targetRunDir, runName, files: entries.length };
}
