import type { NodeType, PromptReferenceItem } from '../types';

export interface ModelPromptProfile {
  modelId: string;
  name: string;
  mediaType: 'image' | 'video' | 'audio';
  mediaAliases: {
    image?: string;
    video?: string;
    audio?: string;
  };
  inlineTemplates: {
    text?: string;
    style?: string;
  };
  positiveTemplate?: string;
  negativeTemplate?: string;
  formatReference: (ref: { type: NodeType; ordinal: number; id: string; title: string }) => string;
}

export const DEFAULT_FALLBACK_PROFILE: ModelPromptProfile = {
  modelId: 'default',
  name: 'Default Model',
  mediaType: 'video',
  mediaAliases: {
    image: 'Image {{ordinal}}',
    video: 'Video {{ordinal}}',
    audio: 'Audio {{ordinal}}',
  },
  inlineTemplates: {
    text: '{{content}}',
    style: '{{content}}',
  },
  positiveTemplate: '{{prompt}}',
  formatReference: ({ type, ordinal }) => `${type === 'image' ? 'Image' : type === 'video' ? 'Video' : 'Audio'} ${ordinal}`,
};

export interface ParsePromptByModelOptions {
  modelId: string;
  prompt: string;
  references?: PromptReferenceItem[];
  profile?: Partial<ModelPromptProfile>;
}

export interface ParsedModelPromptResult {
  modelId: string;
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
 * 按照“模型统筹 (Model-Centric)”统一编译提示词与多模态插槽
 */
export class ModelPromptResolver {
  public static resolve(options: ParsePromptByModelOptions): ParsedModelPromptResult {
    const { modelId, prompt, references = [] } = options;
    const profile: ModelPromptProfile = {
      ...DEFAULT_FALLBACK_PROFILE,
      ...(options.profile ?? {}),
      mediaAliases: {
        ...DEFAULT_FALLBACK_PROFILE.mediaAliases,
        ...(options.profile?.mediaAliases ?? {}),
      },
      inlineTemplates: {
        ...DEFAULT_FALLBACK_PROFILE.inlineTemplates,
        ...(options.profile?.inlineTemplates ?? {}),
      },
      modelId: modelId || 'default',
    };

    const aliases: Record<string, string> = {};
    const styleInjections: string[] = [];

    // 1. 扫描 AST 节点 ID 出现区间
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

    foundOccurrences.sort((a, b) => a.start - b.start || b.end - a.end);
    const uniqueOccurrences = foundOccurrences.filter(
      (item, idx, arr) => idx === 0 || item.start >= arr[idx - 1].end
    );

    // 2. 根据该模型的 mediaAliases 和 inlineTemplates 进行精确替换
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
        const tpl = profile.mediaAliases[ref.type];
        if (tpl) {
          replacement = renderPlaceholder(tpl, values);
        } else {
          replacement = profile.formatReference(ref);
        }
      } else if (ref.type === 'text' || ref.type === 'style') {
        const tpl = profile.inlineTemplates[ref.type];
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

    // 3. 模型专属包装器处理
    let finalPrompt = compiled.trim();
    if (profile.positiveTemplate && finalPrompt) {
      finalPrompt = profile.positiveTemplate.replace('{{prompt}}', finalPrompt);
    }

    return {
      modelId,
      rawPrompt: prompt,
      compiledPrompt: finalPrompt,
      styleInjections,
      aliases,
      detectedReferences: references,
    };
  }
}
