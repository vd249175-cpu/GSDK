import { describe, it, expect } from 'vitest';
import { LaunchpadScheduler } from './launchpad-scheduler';
import type { NodeType } from './types';

describe('LaunchpadScheduler (DAG Orchestration & Header Parsing)', () => {
  it('correctly extracts YAML header parameters and body text', () => {
    const rawPrompt = `---
model: higgs-speech
voiceReference: node_audio_voice_tabby
temperature: 1.2
---

<|prosody:speed_fast|><|emotion:determination|>（急促低喝）点水晶！`;

    const parsed = LaunchpadScheduler.extractModelHeader(rawPrompt);
    expect(parsed.hasHeader).toBe(true);
    expect(parsed.modelId).toBe('higgs-speech');
    expect(parsed.params.voiceReference).toBe('node_audio_voice_tabby');
    expect(parsed.params.temperature).toBe(1.2);
    expect(parsed.body).toBe('<|prosody:speed_fast|><|emotion:determination|>（急促低喝）点水晶！');
  });

  it('correctly computes multi-layer DAG topology, voiceReference dependencies, and readiness status', () => {
    const mockNodes: Record<string, { id: string; type: NodeType; title: string; prompt?: string; content?: string; history?: any[] }> = {
      // 根图与角色音色 (Layer 0)
      node_char_tabby: {
        id: 'node_char_tabby',
        type: 'image',
        title: '室友阿狸立绘',
        prompt: '---\nmodel: nano-banana-image\n---\n二次元男生立绘',
        history: [{ id: 'v1', relativePath: 'media/tabby.png', current: true }],
      },
      node_audio_voice_tabby: {
        id: 'node_audio_voice_tabby',
        type: 'audio',
        title: '室友阿狸音色',
        prompt: '---\nmodel: qwen-voice-design\nvoice_id: node_audio_voice_tabby\n---\n沉稳青年磁性低音',
        history: [], // 尚未生成完成
      },

      // 关键帧与台词 (Layer 1)
      node_kf_dorm_04_start: {
        id: 'node_kf_dorm_04_start',
        type: 'image',
        title: '绝杀指令首帧',
        prompt: '---\nmodel: nano-banana-image\n---\n绝杀指令画面 node_char_tabby 坐在电脑前',
        history: [],
      },
      node_audio_dialogue_dorm_04: {
        id: 'node_audio_dialogue_dorm_04',
        type: 'audio',
        title: '阿狸点水晶指令对白',
        prompt: '---\nmodel: higgs-speech\nvoiceReference: node_audio_voice_tabby\ntemperature: 1.0\n---\n点水晶！',
        history: [],
      },

      // 镜头视频 (Layer 2)
      node_shot_dorm_04: {
        id: 'node_shot_dorm_04',
        type: 'video',
        title: '绝杀指令镜头',
        prompt: '---\nmodel: seedance-video\nresolution: 480p\nduration: 4\n---\n基于 node_kf_dorm_04_start 运镜推向屏幕',
        history: [],
      },
    };

    const items = LaunchpadScheduler.buildLaunchpadItems(mockNodes);

    // 1. 验证项数量
    expect(items).toHaveLength(5);

    const charTabby = items.find(i => i.id === 'node_char_tabby')!;
    const voiceTabby = items.find(i => i.id === 'node_audio_voice_tabby')!;
    const kfDorm04 = items.find(i => i.id === 'node_kf_dorm_04_start')!;
    const audioDialogue = items.find(i => i.id === 'node_audio_dialogue_dorm_04')!;
    const shotDorm04 = items.find(i => i.id === 'node_shot_dorm_04')!;

    // 2. 验证 Layer 拓扑层级
    expect(charTabby.layer).toBe(0);
    expect(voiceTabby.layer).toBe(0);
    expect(kfDorm04.layer).toBe(1);
    expect(audioDialogue.layer).toBe(1);
    expect(shotDorm04.layer).toBe(2);

    // 3. 验证依赖捕获
    expect(kfDorm04.dependencies).toContain('node_char_tabby');
    expect(audioDialogue.dependencies).toContain('node_audio_voice_tabby');
    expect(shotDorm04.dependencies).toContain('node_kf_dorm_04_start');

    // 4. 验证就绪状态计算 (node_char_tabby 已有 current 产物，故 kfDorm04 就绪；voiceTabby 无产物，故 audioDialogue 处于 pending)
    expect(charTabby.status).toBe('completed');
    expect(kfDorm04.areDependenciesReady).toBe(true);
    expect(kfDorm04.status).toBe('ready');

    expect(audioDialogue.areDependenciesReady).toBe(false);
    expect(audioDialogue.missingDependencies).toContain('node_audio_voice_tabby');
    expect(audioDialogue.status).toBe('pending');
  });

  it('does not mark an empty prompt or missing model header as launchable', () => {
    const items = LaunchpadScheduler.buildLaunchpadItems({
      empty: {
        id: 'empty', type: 'image', title: '空提示词',
        prompt: '---\nmodel: nano-banana-image\n---\n', history: [],
      },
      missingModel: {
        id: 'missingModel', type: 'audio', title: '缺少模型',
        prompt: '只有正文', history: [],
      },
    });

    expect(items.find((item) => item.id === 'empty')).toMatchObject({
      isReady: false,
      status: 'pending',
      statusMessage: '生成提示词正文不能为空',
    });
    expect(items.find((item) => item.id === 'missingModel')).toMatchObject({
      dispatchMode: 'manual-web',
      isReady: false,
      status: 'manual_waiting',
      statusMessage: '手动网页生成：可复制提示词与依赖',
    });
    expect(items.filter((item) => item.isReady).map((item) => item.id)).not.toContain('missingModel');
  });

  it('captures style and text references and treats non-empty content as ready', () => {
    const items = LaunchpadScheduler.buildLaunchpadItems({
      style_node: {
        id: 'style_node', type: 'style', title: '暖金胶片',
        content: '柯达暖金影调，大光圈浅景深',
      },
      text_node: {
        id: 'text_node', type: 'text', title: '分镜台词',
        content: '小猫咪乖巧对视',
      },
      manual_task: {
        id: 'manual_task', type: 'image', title: '猫咪画面',
        prompt: '近景俯拍小猫咪。 风格：&暖金胶片，台词：[$分镜台词]', history: [],
      },
    });

    const manualTask = items.find((item) => item.id === 'manual_task')!;
    expect(manualTask.dependencies).toEqual(expect.arrayContaining(['style_node', 'text_node']));
    expect(manualTask.areDependenciesReady).toBe(true);
    expect(manualTask.status).toBe('manual_waiting');
    expect(manualTask.statusMessage).toBe('手动网页生成：可复制提示词与依赖');
  });

  it('orders mixed dependencies by their first occurrence instead of project insertion order', () => {
    const items = LaunchpadScheduler.buildLaunchpadItems({
      image_a: { id: 'image_a', type: 'image', title: '前景', history: [] },
      audio_a: { id: 'audio_a', type: 'audio', title: '环境声', history: [] },
      image_b: { id: 'image_b', type: 'image', title: '背景', history: [] },
      target: {
        id: 'target', type: 'video', title: '镜头', history: [],
        prompt: '---\nmodel: seedance-video\n---\n先 [@背景]，再 [~环境声]，最后 [@前景]。',
      },
    });

    expect(items.find((item) => item.id === 'target')?.dependencies).toEqual([
      'image_b', 'audio_a', 'image_a',
    ]);
  });
});
