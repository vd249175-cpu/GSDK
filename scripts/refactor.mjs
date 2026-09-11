#!/usr/bin/env node
/**
 * scripts/refactor.mjs
 * 
 * 基于 TypeScript Compiler API / LanguageService 的项目级 AST 重构与符号索引工具。
 * 支持：跨文件符号重命名（F2 同款）、查找引用、全局文本替换。
 * 
 * 用法：
 *   node scripts/refactor.mjs rename <file> <symbol> <newName> [--line <line>]
 *   node scripts/refactor.mjs find-refs <file> <symbol> [--line <line>]
 *   node scripts/refactor.mjs replace-text <search> <replace> [--ext <extensions>]
 */

import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function createLanguageService(configPath = path.join(root, 'tsconfig.json')) {
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(`读取 tsconfig 失败: ${configFile.error.messageText}`);
  }
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configPath)
  );

  const files = new Map();
  for (const fileName of parsed.fileNames) {
    files.set(fileName, { version: 0 });
  }

  const host = {
    getScriptFileNames: () => parsed.fileNames,
    getScriptVersion: (fileName) => {
      const norm = path.normalize(fileName);
      const f = files.get(norm) || files.get(fileName);
      return f ? String(f.version) : '0';
    },
    getScriptSnapshot: (fileName) => {
      if (!fs.existsSync(fileName)) return undefined;
      return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf8'));
    },
    getCurrentDirectory: () => root,
    getCompilationSettings: () => parsed.options,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };

  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  return { service, parsed };
}

function findSymbolPosition(sourceFile, symbolName, targetLine = null) {
  let matchPos = null;

  function visit(node) {
    if (matchPos !== null) return;

    if (ts.isIdentifier(node) && node.text === symbolName) {
      const start = node.getStart(sourceFile);
      const { line } = sourceFile.getLineAndCharacterOfPosition(start);
      // line is 0-indexed
      if (targetLine === null || line + 1 === targetLine) {
        // Prioritize declarations (class, interface, type, var, function, method, property)
        const parent = node.parent;
        const isDeclaration = parent && (
          ts.isClassDeclaration(parent) ||
          ts.isInterfaceDeclaration(parent) ||
          ts.isTypeAliasDeclaration(parent) ||
          ts.isVariableDeclaration(parent) ||
          ts.isFunctionDeclaration(parent) ||
          ts.isMethodDeclaration(parent) ||
          ts.isPropertyDeclaration(parent) ||
          ts.isExportSpecifier(parent) ||
          ts.isImportSpecifier(parent)
        ) && parent.name === node;

        if (isDeclaration || targetLine !== null) {
          matchPos = start;
          return;
        }

        // Fallback candidate
        if (matchPos === null) matchPos = start;
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return matchPos;
}

function handleFindRefs(args) {
  const filePath = path.resolve(root, args[0]);
  const symbolName = args[1];
  const lineFlagIdx = args.indexOf('--line');
  const targetLine = lineFlagIdx !== -1 ? parseInt(args[lineFlagIdx + 1], 10) : null;

  if (!fs.existsSync(filePath)) {
    console.error(`[Error] 文件不存在: ${filePath}`);
    process.exit(1);
  }

  console.log(`[refactor] 正在初始化 TypeScript Language Service...`);
  const { service } = createLanguageService();
  const program = service.getProgram();
  const sourceFile = program.getSourceFile(filePath);

  if (!sourceFile) {
    console.error(`[Error] 无法从 tsconfig 中加载文件: ${filePath}`);
    process.exit(1);
  }

  const pos = findSymbolPosition(sourceFile, symbolName, targetLine);
  if (pos === null) {
    console.error(`[Error] 在 ${filePath} 中未找到符号 "${symbolName}"${targetLine ? ` (行 ${targetLine})` : ''}`);
    process.exit(1);
  }

  const refs = service.findReferences(filePath, pos);
  if (!refs || refs.length === 0) {
    console.log(`[refactor] 未找到对 "${symbolName}" 的引用。`);
    return;
  }

  let totalCount = 0;
  console.log(`\n=== 符号 "${symbolName}" 引用清单 ===`);
  for (const refGroup of refs) {
    for (const ref of refGroup.references) {
      totalCount++;
      const refFile = program.getSourceFile(ref.fileName);
      const { line, character } = refFile.getLineAndCharacterOfPosition(ref.textSpan.start);
      const relPath = path.relative(root, ref.fileName);
      const isDef = ref.isDefinition ? ' (定义)' : '';
      console.log(`  ${relPath}:${line + 1}:${character + 1}${isDef}`);
    }
  }
  console.log(`\n共找到 ${totalCount} 处引用。\n`);
}

function handleRename(args) {
  const filePath = path.resolve(root, args[0]);
  const oldName = args[1];
  const newName = args[2];
  const lineFlagIdx = args.indexOf('--line');
  const targetLine = lineFlagIdx !== -1 ? parseInt(args[lineFlagIdx + 1], 10) : null;

  if (!filePath || !oldName || !newName) {
    console.error(`用法: node scripts/refactor.mjs rename <file> <oldName> <newName> [--line <N>]`);
    process.exit(1);
  }

  console.log(`[refactor] 正在初始化 Language Service 并分析 "${oldName}" -> "${newName}"...`);
  const { service } = createLanguageService();
  const program = service.getProgram();
  const sourceFile = program.getSourceFile(filePath);

  if (!sourceFile) {
    console.error(`[Error] 无法从工程配置中加载文件: ${filePath}`);
    process.exit(1);
  }

  const pos = findSymbolPosition(sourceFile, oldName, targetLine);
  if (pos === null) {
    console.error(`[Error] 在 ${filePath} 中未找到符号 "${oldName}"${targetLine ? ` (行 ${targetLine})` : ''}`);
    process.exit(1);
  }

  const renameLocations = service.findRenameLocations(filePath, pos, false, false);
  if (!renameLocations || renameLocations.length === 0) {
    console.log(`[refactor] 未找到可重命名的引用位置。`);
    return;
  }

  // Group by file
  const byFile = new Map();
  for (const loc of renameLocations) {
    if (!byFile.has(loc.fileName)) byFile.set(loc.fileName, []);
    byFile.get(loc.fileName).push(loc.textSpan);
  }

  console.log(`\n[refactor] 找到来自 ${byFile.size} 个文件的 ${renameLocations.length} 处符号引用，正在应用变更...`);

  let modifiedFilesCount = 0;
  for (const [file, spans] of byFile.entries()) {
    let content = fs.readFileSync(file, 'utf8');
    // Sort descending by start offset to prevent offset drift
    spans.sort((a, b) => b.start - a.start);

    for (const span of spans) {
      const before = content.slice(0, span.start);
      const after = content.slice(span.start + span.length);
      content = before + newName + after;
    }

    fs.writeFileSync(file, content, 'utf8');
    const rel = path.relative(root, file);
    console.log(`  [修改] ${rel} (${spans.length} 处替换)`);
    modifiedFilesCount++;
  }

  console.log(`\n✅ 重命名完成！成功更新 ${modifiedFilesCount} 个文件，${renameLocations.length} 处引用已安全重构为 "${newName}"。\n`);
}

function handleReplaceText(args) {
  const search = args[0];
  const replace = args[1];
  if (!search || replace === undefined) {
    console.error(`用法: node scripts/refactor.mjs replace-text <search> <replace> [--ext <ext1,ext2>]`);
    process.exit(1);
  }

  const extIdx = args.indexOf('--ext');
  const exts = extIdx !== -1 ? args[extIdx + 1].split(',').map(e => e.trim().startsWith('.') ? e.trim() : `.${e.trim()}`) : ['.ts', '.tsx', '.mjs', '.json', '.md'];

  function scanAndReplace(dir) {
    let changed = 0;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
        changed += scanAndReplace(full);
      } else if (entry.isFile()) {
        if (!exts.some(ext => entry.name.endsWith(ext))) continue;
        const content = fs.readFileSync(full, 'utf8');
        if (content.includes(search)) {
          const updated = content.replaceAll(search, replace);
          fs.writeFileSync(full, updated, 'utf8');
          console.log(`  [替换] ${path.relative(root, full)}`);
          changed++;
        }
      }
    }
    return changed;
  }

  console.log(`[refactor] 正在全仓文本替换: "${search}" -> "${replace}" (扩展名: ${exts.join(', ')})...`);
  const count = scanAndReplace(root);
  console.log(`\n✅ 替换完成！更新了 ${count} 个文件。\n`);
}

const [,, command, ...rest] = process.argv;

switch (command) {
  case 'rename':
    handleRename(rest);
    break;
  case 'find-refs':
  case 'refs':
    handleFindRefs(rest);
    break;
  case 'replace-text':
  case 'replace':
    handleReplaceText(rest);
    break;
  default:
    console.log(`
GraphFramework AST & Global Refactoring Tool

命令：
  node scripts/refactor.mjs rename <file> <symbol> <newName> [--line <line>]
    基于 TypeScript AST 语义安全重命名符号（自动级联更新跨文件所有引用与 imports）

  node scripts/refactor.mjs find-refs <file> <symbol> [--line <line>]
    利用 LanguageService 列出符号在全仓中的所有真实调用点与定义点

  node scripts/refactor.mjs replace-text <search> <replace> [--ext .ts,.tsx,.md]
    全仓文本/路径快速批量替换（自动忽略 node_modules/、dist/、.git/）
`);
    break;
}
