import { describe, it, expect } from 'vitest';
import { MarkdownSourceNode } from '../markdown-source';
import { createCausalRegionHarness } from '../../testing/graph';

describe('MarkdownSourceNode 3-Way Safe Monotonic Evolution', () => {
  it('safely advances revision and applies ProjectDocumentReplacementInfo monotonically', async () => {
    const mdNode = new MarkdownSourceNode('test-md', 'Markdown 文本源', '# Initial Title\n\nContent');
    const region = createCausalRegionHarness([mdNode]);
    expect(mdNode.getState().revision).toBe(0);

    // 模拟用户键入，revision 递增为 1
    await region.inject(mdNode.id, {
      type: 'ProjectDocumentReplacementInfo',
      markdown: '# Updated Title\n\nContent with more details',
      baseRevision: 0,
      label: 'ProjectDocumentReplacementInfo',
    });

    expect(mdNode.getState().revision).toBe(1);
    expect(mdNode.getState().markdown).toContain('# Updated Title');

    // 模拟树编辑基于历史 baseRevision 0 提交替换，节点安全递增至 revision 2 而非抛出冲突崩溃
    await region.inject(mdNode.id, {
      type: 'ProjectDocumentReplacementInfo',
      markdown: '# Updated Title\n\n## Sub Section\n\nContent with more details',
      baseRevision: 0,
      label: 'ProjectDocumentReplacementInfo',
    });

    expect(mdNode.getState().revision).toBe(2);
    expect(mdNode.getState().markdown).toContain('## Sub Section');
    await region.dispose();
  });

  it('rejects invalid baseRevision with a descriptive error', async () => {
    const mdNode = new MarkdownSourceNode('test-md', 'Markdown 文本源', '# Initial');
    const region = createCausalRegionHarness([mdNode]);

    await region.inject(mdNode.id, {
      type: 'ProjectDocumentReplacementInfo',
      markdown: '# Next',
      baseRevision: 'invalid-number' as any,
      label: 'ProjectDocumentReplacementInfo',
    });
    expect(mdNode.status).toBe('ERROR');
    expect(mdNode.lastErrorMessage).toContain('项目文档 baseRevision 非法');
    await region.dispose();
  });
});
