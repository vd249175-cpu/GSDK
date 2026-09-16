/**
 * 纯逻辑：提示词 YAML 解析与模板变量注入编译引擎
 */

export interface ParsedPrompt {
  headerConfig: Record<string, any>;
  body: string;
  modelId: string | null;
  hasFrontMatter: boolean;
}

export class PromptCompiler {
  /**
   * 解析提示词 frontmatter 与正文
   */
  public static parse(source: string): ParsedPrompt {
    if (typeof source !== 'string') return { headerConfig: {}, body: '', modelId: null, hasFrontMatter: false };
    const normalized = source.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');

    if (lines[0]?.trim() !== '---') {
      return { headerConfig: {}, body: normalized.trim(), modelId: null, hasFrontMatter: false };
    }

    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (end < 0) {
      return { headerConfig: {}, body: normalized.trim(), modelId: null, hasFrontMatter: false };
    }

    const headerLines = lines.slice(1, end);
    const body = lines.slice(end + 1).join('\n').trim();

    // 简单轻量 Key-Value 解析，避免庞大第三方依赖
    const config: Record<string, any> = {};
    for (const line of headerLines) {
      const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.+?)\s*$/);
      if (match) {
        const key = match[1];
        let val: any = match[2];
        if (val === 'true') val = true;
        else if (val === 'false') val = false;
        else if (!isNaN(Number(val))) val = Number(val);
        else if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        config[key] = val;
      }
    }

    const modelId = typeof config.model === 'string' ? config.model : null;
    return { headerConfig: config, body, modelId, hasFrontMatter: true };
  }

  /**
   * 变量占位符注入 (支持 {{variable}} 语法替换)
   */
  public static compile(template: string, variables: Record<string, any>): string {
    return template.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (match, key) => {
      if (variables[key] !== undefined && variables[key] !== null) {
        return String(variables[key]);
      }
      return match;
    });
  }
}
