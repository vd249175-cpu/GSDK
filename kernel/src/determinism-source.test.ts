import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('deterministic domain source boundary', () => {
  it('keeps Kernel imports inside the Kernel and excludes analysis and presentation from its base class', () => {
    const root = resolve('kernel/src');
    const violations = sourceFiles(root).filter((file) => !file.endsWith('.test.ts')).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return ts.preProcessFile(source, true, true).importedFiles.flatMap(({ fileName }) => {
        const target = relative(root, resolve(dirname(file), fileName));
        return !fileName.startsWith('.') || target.startsWith('..') || isAbsolute(target)
          ? [`${relative(root, file)} -> ${fileName}`] : [];
      });
    });
    expect(violations).toEqual([]);
    const node = ts.createSourceFile('node.ts', readFileSync(join(root, 'node.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
    const base = node.statements.find((statement): statement is ts.ClassDeclaration => ts.isClassDeclaration(statement) && statement.name?.text === 'Node')!;
    expect(base.heritageClauses).toBeUndefined();
    const members = base.members.map((member) => member.name?.getText(node));
    for (const removed of ['icon', 'description', 'category', 'subtitle', 'describeAnalysisInstance']) {
      expect(members).not.toContain(removed);
    }
  });

  it('does not use ambient wall clock or randomness in Node implementations', () => {
    const files = [
      ...sourceFiles(join(process.cwd(), 'app/src/nodes')),
      join(process.cwd(), 'kernel/src/node.ts'),
    ].filter(file => existsSync(file));

    const violations = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return /\b(?:Date\.now|Math\.random|crypto\.randomUUID)\s*\(/.test(source)
        ? [file.replace(`${process.cwd()}\\`, '')]
        : [];
    });

    expect(violations).toEqual([]);
  });
});
