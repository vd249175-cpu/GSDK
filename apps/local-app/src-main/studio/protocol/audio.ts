import type { Info } from '@graphvideo/kernel';
import type { AudioTaskPayload } from '../domain/audio/types';

export interface UserAudioTaskInfo extends Info {
  readonly type: 'UserAudioTaskInfo';
  readonly targetNodeId: string;
  readonly taskId?: string;
  readonly projectId?: string;
  readonly task: AudioTaskPayload;
}

export interface ServerAddressConfigInfo extends Info {
  readonly type: 'ServerAddressConfigInfo';
  readonly address: string;
}
