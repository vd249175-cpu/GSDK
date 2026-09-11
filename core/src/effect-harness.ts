import type { Clock } from './observation';
import { systemClock } from './observation';
import {
  ValueCodec,
  type EncodedValue,
  type ValueCodecOptions,
} from './observation';
import type { EffectAdapter, EffectContext } from './effects';

export interface EffectFixture<Request> {
  readonly schemaVersion: 1;
  readonly fixtureId: string;
  readonly request: Request;
  readonly expectedObservation?: EncodedValue;
}

export interface EffectHarnessRecord {
  readonly schemaVersion: 1;
  readonly fixtureId: string;
  readonly executionId: string;
  readonly adapterId: string;
  readonly request: EncodedValue;
  readonly observation?: EncodedValue;
  readonly transportMetadata: readonly EncodedValue[];
  readonly rawSummaries: readonly {
    readonly kind: string;
    readonly text: string;
    readonly redacted: boolean;
  }[];
  readonly startedAt: number;
  readonly completedAt: number;
  readonly durationMs: number;
  readonly status: 'succeeded' | 'failed';
  readonly expectedMatched?: boolean;
  readonly error?: string;
}

export interface EffectHarnessResult<Observation> {
  readonly record: EffectHarnessRecord;
  readonly observation?: Observation;
}

export interface EffectHarnessOptions {
  readonly clock?: Clock;
  readonly valueCodec?: ValueCodec;
  readonly valueCodecOptions?: ValueCodecOptions;
  readonly maxFixtureBytes?: number;
  readonly maxRawSummaryCharacters?: number;
}

const defaultMaxFixtureBytes = 64 * 1024;
const defaultMaxRawSummaryCharacters = 2_048;

export class EffectHarness {
  private readonly clock: Clock;
  private readonly valueCodec: ValueCodec;
  private readonly valueCodecOptions: ValueCodecOptions;
  private readonly maxFixtureBytes: number;
  private readonly maxRawSummaryCharacters: number;

  constructor(options: EffectHarnessOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.valueCodec = options.valueCodec ?? new ValueCodec();
    this.valueCodecOptions = options.valueCodecOptions ?? {};
    this.maxFixtureBytes = options.maxFixtureBytes ?? defaultMaxFixtureBytes;
    this.maxRawSummaryCharacters =
      options.maxRawSummaryCharacters ?? defaultMaxRawSummaryCharacters;
    if (!Number.isSafeInteger(this.maxFixtureBytes) || this.maxFixtureBytes <= 0) {
      throw new Error('EffectHarness maxFixtureBytes 必须是正安全整数');
    }
    if (
      !Number.isSafeInteger(this.maxRawSummaryCharacters) ||
      this.maxRawSummaryCharacters <= 0
    ) {
      throw new Error('EffectHarness maxRawSummaryCharacters 必须是正安全整数');
    }
  }

  async run<Request, Observation>(
    adapter: EffectAdapter<Request, Observation>,
    fixture: EffectFixture<Request>,
    options: { signal?: AbortSignal } = {},
  ): Promise<EffectHarnessResult<Observation>> {
    if (!adapter.id.trim()) throw new Error('EffectAdapter id 不能为空');
    if (fixture.schemaVersion !== 1) {
      throw new Error(`EffectFixture schemaVersion 不支持: ${fixture.schemaVersion}`);
    }
    if (!fixture.fixtureId.trim()) throw new Error('EffectFixture fixtureId 不能为空');
    if (options.signal?.aborted) throw options.signal.reason ?? new Error('Effect 已取消');

    const request = this.valueCodec.encode(fixture.request, {
      ...this.valueCodecOptions,
      maxBytes: Math.min(
        this.valueCodecOptions.maxBytes ?? this.maxFixtureBytes,
        this.maxFixtureBytes,
      ),
      rootPath: ['fixture', 'request'],
    });
    const transportMetadata: EncodedValue[] = [];
    const rawSummaries: Array<{ kind: string; text: string; redacted: boolean }> = [];
    const startedAt = this.clock.now();
    const monotonicStart = this.clock.monotonicNow();
    const executionId = `${fixture.fixtureId}/${adapter.id}`;
    const context: EffectContext = {
      clock: this.clock,
      signal: options.signal,
      recordTransport: (metadata) => {
        transportMetadata.push(
          this.valueCodec.encode(metadata, {
            ...this.valueCodecOptions,
            maxBytes: this.maxFixtureBytes,
            rootPath: ['transportMetadata', String(transportMetadata.length)],
          }),
        );
      },
      recordRawSummary: (summary) => {
        if (!summary.kind.trim()) throw new Error('Effect raw summary kind 不能为空');
        if (summary.text.length > this.maxRawSummaryCharacters) {
          throw new Error(
            `Effect raw summary 超过 ${this.maxRawSummaryCharacters} 字符限制`,
          );
        }
        rawSummaries.push({
          kind: summary.kind,
          text: summary.text,
          redacted: summary.redacted ?? false,
        });
      },
    };

    try {
      const observation = await adapter.execute(fixture.request, context);
      const encodedObservation = this.valueCodec.encode(observation, {
        ...this.valueCodecOptions,
        maxBytes: this.maxFixtureBytes,
        rootPath: ['fixture', 'observation'],
      });
      const completedAt = this.clock.now();
      const durationMs = this.clock.monotonicNow() - monotonicStart;
      return {
        observation,
        record: {
          schemaVersion: 1,
          fixtureId: fixture.fixtureId,
          executionId,
          adapterId: adapter.id,
          request,
          observation: encodedObservation,
          transportMetadata,
          rawSummaries,
          startedAt,
          completedAt,
          durationMs,
          status: 'succeeded',
          ...(fixture.expectedObservation === undefined
            ? {}
            : {
                expectedMatched:
                  JSON.stringify(encodedObservation) ===
                  JSON.stringify(fixture.expectedObservation),
              }),
        },
      };
    } catch (error) {
      const completedAt = this.clock.now();
      return {
        record: {
          schemaVersion: 1,
          fixtureId: fixture.fixtureId,
          executionId,
          adapterId: adapter.id,
          request,
          transportMetadata,
          rawSummaries,
          startedAt,
          completedAt,
          durationMs: this.clock.monotonicNow() - monotonicStart,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}
