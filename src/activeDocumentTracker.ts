export interface ActiveContext {
  tableName: string;
  filePath: string;
  schema: Array<{ name: string; type: string }>;
  nullPercents: Record<string, number>;
  currentSql: string;
  sampleColumns: string[];
  sampleRows: any[][];
}

/** Singleton that holds the context of whichever QuackTable editor is currently focused. */
export class ActiveDocumentTracker {
  private static _ctx: ActiveContext | null = null;

  static set(ctx: ActiveContext | null): void {
    this._ctx = ctx;
  }

  static get(): ActiveContext | null {
    return this._ctx;
  }
}
