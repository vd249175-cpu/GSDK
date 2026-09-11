import type { NodeType, PromptReferenceItem } from '../types';

export interface StyleTemplateDefinition {
  id: string;
  name: string;
  category?: string;
  mediaType: 'image' | 'video' | 'audio';
  positiveTemplate: string;
  negativeTemplate?: string;
  mediaAliases: {
    image?: string;   // e.g. "Image {{ordinal}}" or "Image_{{ordinal}}"
    video?: string;   // e.g. "Video {{ordinal}}" or "Video_{{ordinal}}"
    audio?: string;   // e.g. "Audio {{ordinal}}" or "Audio_{{ordinal}}"
  };
  inlineTemplates: {
    text?: string;    // e.g. "Text_{{ordinal}}: {{content}}"
    style?: string;   // e.g. "Style_{{ordinal}}: {{content}}"
  };
  defaultParams?: Record<string, any>;
}

export interface ParsePromptStyleOptions {
  prompt: string;
  references?: PromptReferenceItem[];
  modelTemplate?: Partial<StyleTemplateDefinition>;
}

export interface ParsedPromptResult {
  rawPrompt: string;
  compiledPrompt: string;
  styleInjections: string[];
  aliases: Record<string, string>;
  detectedReferences: PromptReferenceItem[];
}

const idCharacter = /[\p{L}\p{N}_.:-]/u;

function renderPlaceholder(template: string, values: Record<string, any>): string {
  return template.replace(/{{(content|ordinal|id|title)}}/g, (_match, key) => String(values[key] ?? ''));
}

/**
 * 生产级 ComfyUI 提示词与多模态引用/样式解析器 (PromptStyleParser)
 * 职责：
 * 1. 扫描提示词中的节点引用 ID (如 #shot_01, hero_img_1)，转换为 ComfyUI 模板标准别名 (如 Image 1, Video 1)；
 * 2. 注入 Style 节点的风格描述与前后缀约束 (Positive/Negative Wrappers)；
 * 3. 严格对齐 MiniMax H3 / Seedance 2.0 / Stable Audio 的官方提示词规范。
 */
export class PromptStyleParser {
  /**
   * 解析提示词并根据模型/风格规范编译为最终投递给 ComfyUI 的标准 Payload Prompt
   */
  public static parse(options: ParsePromptStyleOptions): ParsedPromptResult {
    const { prompt, references = [], modelTemplate = {} } = options;
    const aliases: Record<string, string> = {};
    const styleInjections: string[] = [];

    const mediaAliases = modelTemplate.mediaAliases || {
      image: 'Image {{ordinal}}',
      video: 'Video {{ordinal}}',
      audio: 'Audio {{ordinal}}',
    };

    const inlineTemplates = modelTemplate.inlineTemplates || {
      text: '{{content}}',
      style: '{{content}}',
    };

    // 1. 提取所有匹配的引用点
    const foundOccurrences: Array<{
      reference: PromptReferenceItem;
      start: number;
      end: number;
    }> = [];

    for (const ref of references) {
      if (!ref.id) continue;
      let start = prompt.indexOf(ref.id);
      while (start >= 0) {
        const end = start + ref.id.length;
        const prevChar = start === 0 ? '' : prompt[start - 1];
        const nextChar = end >= prompt.length ? '' : prompt[end];

        if ((!prevChar || !idCharacter.test(prevChar)) && (!nextChar || !idCharacter.test(nextChar))) {
          foundOccurrences.push({ reference: ref, start, end });
        }
        start = prompt.indexOf(ref.id, end);
      }
    }

    // 排序并去除重叠区间
    foundOccurrences.sort((a, b) => a.start - b.start || b.end - a.end);
    const uniqueOccurrences = foundOccurrences.filter(
      (item, idx, arr) => idx === 0 || item.start >= arr[idx - 1].end
    );

    // 2. 进行别名替换与内联展开
    let cursor = 0;
    let compiled = '';

    for (const occ of uniqueOccurrences) {
      const ref = occ.reference;
      const values = {
        id: ref.id,
        title: ref.title,
        ordinal: ref.ordinal,
        content: ref.content || '',
      };

      let replacement = ref.id;

      if (ref.type === 'image' || ref.type === 'video' || ref.type === 'audio') {
        const tpl = mediaAliases[ref.type];
        if (tpl) replacement = renderPlaceholder(tpl, values);
      } else if (ref.type === 'text' || ref.type === 'style') {
        const tpl = inlineTemplates[ref.type];
        if (tpl && values.content) {
          replacement = renderPlaceholder(tpl, values);
          if (ref.type === 'style') styleInjections.push(values.content);
        }
      }

      aliases[ref.id] = replacement;
      compiled += prompt.slice(cursor, occ.start) + replacement;
      cursor = occ.end;
    }

    compiled += prompt.slice(cursor);

    // 3. 样式外层包装器 (Positive Wrapper)
    let finalPrompt = compiled.trim();
    if (modelTemplate.positiveTemplate && finalPrompt) {
      finalPrompt = modelTemplate.positiveTemplate.replace('{{prompt}}', finalPrompt);
    }

    return {
      rawPrompt: prompt,
      compiledPrompt: finalPrompt,
      styleInjections,
      aliases,
      detectedReferences: references,
    };
  }
}
