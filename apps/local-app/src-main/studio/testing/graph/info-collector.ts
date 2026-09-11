import { Node, type ChangeContext, type Info } from '../@graphvideo/kernel';

export interface InfoCollectorState {
  readonly received: readonly Info[];
}

/** Boundary-only test Node. It records Info without reproducing production state machines. */
export class InfoCollectorNode extends Node<InfoCollectorState> {
  private readonly acceptedTypes: ReadonlySet<string> | null;

  constructor(
    id: string,
    acceptedTypes: readonly string[] = [],
    name: string = `Info collector: ${id}`,
  ) {
    super(id, name, { received: [] });
    this.acceptedTypes = acceptedTypes.length > 0 ? new Set(acceptedTypes) : null;
  }

  protected override change(info: Info, ctx: ChangeContext<InfoCollectorState>): void {
    if (this.acceptedTypes && !this.acceptedTypes.has(info.type)) return;
    ctx.write('received', [...ctx.read('received'), info]);
  }

  received(infoType?: string): readonly Info[] {
    const infos = this.getState().received;
    return infoType ? infos.filter((info) => info.type === infoType) : infos;
  }
}
